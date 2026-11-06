# Design Studio render fidelity — round 1 (2026-11-06)

Candidate scope: `loop/design-render-fidelity/r001`, base
`7864c26bd16849f0d534dffaad3a5bdf4c8644e8`. This is a local candidate;
no installed package, Host, user design, release, remote branch or coordination
ledger is modified. The same CC planning session must independently review this
checkpoint; this report does not substitute for that review.

**Disposition:** implementation, functional tests and repository checks pass.
Full visual acceptance remains red: 95 synthetic and 1724 real-document failing
comparison rows. This is a reviewable round-1 checkpoint, not a claim that all
styles match or that CC has approved the remaining thresholds/differences.

## Root causes and bounded changes

- Unimported text previously treated `y` as a hanging baseline in SVG/GPU, but
  HTML, browser canvas and layout treat it as the top of a line box. A shared
  `text-line-box.mjs` defines the new no-offset convention. Finite
  `layoutBaselineOffset`, including zero and negative values, retains the
  historical hanging convention. No migration or coordinate compensation is
  applied to saved designs.
- Legacy HTML `strokeWidth` used a CSS border, shrinking the containing block
  and displacing children. It now uses outer/inset half-width shadows for a
  centered stroke without layout consumption. Text uses glyph text-stroke.
  Scalar shadows remain behind strokes. A measured 0.5px width deficit in
  explicit center strokes also justified replacing their fractional outline
  with exact half-width shadows. Inside/outside paths and the shadowStack
  supported-input contract are preserved.
- Ink receipt signatures distinguish no-offset line-box measurements from
  old hanging measurements, so stale receipts cannot silently validate the
  wrong reference frame. Imported finite-offset signatures remain compatible.
  The existing import mapping reconfigures its measurer after setting an offset,
  and the layout cache records the resulting signature. SVG previews carry the
  measured alphabetic offset and source metrics signature as render-context metadata; the Node checker
  replays it and still compares the entire regenerated SVG. This is a freshness
  check, not authentication of the font metrics or proof of visual correctness.
- No-offset native paragraphs now apply the verified font's optical-size axis,
  matching CSS automatic optical sizing. Finite-offset and mixed-typography
  native font instances retain their prior variation settings.
- Signature consumers are part of this bounded compatibility fix: native text
  content provenance must recognize both historical signatures and the exact
  new origin marker. Semantic document comparison must distinguish an absent
  offset from finite zero. The latter now denotes a different renderer origin,
  even though both have a zero numeric coordinate adjustment.

## Environment and evidence custody

Validation runs on Darwin arm64, Node v25.8.1, npm 11.11.0, with an independent
`npm ci` in this worktree and cached Playwright Chromium 148.0.7778.96. PingFang SC
is installed in the macOS Font7 asset and was successfully loaded with
`local("PingFangSC-Regular")`; it is tested, not skipped. Inter uses the package's
exact `InterVariable.woff2` bytes. All browser runs use
private test contexts and intercepted local package requests. GPU means actual
CanvasKit/WebGL through SwiftShader, not a claim about physical GPU speed.
No account, credential, user browser tab or network fidelity collector is used.

Temporary evidence root (not committed):
`/Users/admin/.codex/worktrees/panels-design-render-fidelity-r001/.tmp/render-fidelity-r001/`.
The exact base app is archived there under `base/apps/design-studio/app`.
The opt-in six-page portable design is only read from the authorized path;
its source SHA-256 is
`91d877f8dbb28dce4c698b850c0db7455be2471c9d052f5cdf138c35f47dfc24`.
Its 807 nodes include 232 text nodes and 101 legacy stroked nodes. The private
design and its screenshots are not included in the commit.

## Gates

All pixel-gate comparison crops use matching viewport, fonts, DPR and zoom. Matrix:
DPR1/zoom1, DPR2/zoom1, DPR1/zoom2, and DPR1/zoom0.5 coarse diagnostics.
At scale 1, text top/bottom differ by at most 1 device pixel; at scale >=2,
at most 2. Left alignment <=1, center/right <=1.5, non-descender centroid
<=0.75. Stroke scan centroid/width <=0.35 and child edges <=0.5.
Secondary pixels use symmetric 3x3 RGBA search, channel tolerance 24,
text mismatch <=0.5%, shapes <=0.1%, largest 8-connected cluster <=6 pixels.
Radius error must be <=0.5 device px; rotation centroid <=0.5 device px and
direction <=0.5 degrees; exterior shadow centroid <=1 device px and alpha
within 10%. At half zoom the secondary pixel gate remains active and primary
geometry remains reported as coarse diagnostics, not primary acceptance.
Geometry is independent of that tolerant pixel comparison: injected 1px shifts
must fail centroid checks even when the 3x3 pixel metric accepts them; 2px
shifts must fail both. Missing or ambiguous measurements are unavailable,
never converted to zero differences. These candidate thresholds are unchanged.

## Baseline and focused evidence

- `b2-baseline-red.log`: original HTML stroke regression fails 3 of 4 pure
  contract checks. Candidate passes those checks plus actual Chromium geometry
  and text-stroke paint checks (`b2-candidate-ui.log`).
- `spike/metrics.json`: unquantized SVG central+half-line-height fails the
  proposed <=0.5 CSS px spike threshold: 14px Inter/system at 1.2 line height
  differs by 1 CSS px at DPR2. It was rejected in that form.
- `imported-base-digests.json`: exact finite-offset SVG and serialized document
  digests captured from the base; regression covers positive/zero/negative
  offsets, multiline, alignment and paint-only ranges.
- `baseline-clean.log` / `baseline-clean/report.json`: frozen synthetic fixture,
  strict exit 1, 12 four-route comparisons, 255 failing rows, 24 diagnostic
  failures, no unavailable/missing/partial probes. Exploratory runs in
  `base-ui`, `base-matrix`, `base-real` and `candidate-debug` are superseded and
  must not be used for direct headline before/after comparisons.
- `b2-explicit-center-ui.log`: 7/7 tests, 64 flat stroke probes across 1–4px and
  DPR1/2, containing-block and clipping checks; existing scalar shadow order
  and shadowStack validation covered. The initial legacy set's maximum stroke
  centroid delta is 0.002458 device px and width delta 0.004916; symmetric
  mismatch and largest cluster are zero.
- `text-line-box/metrics.json`: all 360 DOM alphabetic baselines agree with
  `floor((LH + round(ascent) - round(descent)) / 2)` within 1/64 CSS px. The
  unchanged half-CSS-pixel screenshot spike is **not fully accepted**: six
  system-ui 14px CJK/mixed zoom2 cases differ by 0.552–0.670 CSS px in centroid.
  Observed glyph widths differ too, so this is retained as transform/fallback
  rasterization evidence, not corrected by an arbitrary baseline shift.
- `radius-probe.json` / `radius-width-probe.log`: dual-shadow rounded strokes
  have a pixel seam despite passing radius geometry; 4px DPR1 mismatch ~0.293%,
  DPR2 ~0.344% and cluster 18. Outline alternatives break odd-width placement
  or container clipping/children, so no unreviewed special case was adopted.

The synthetic fixture is laid out once before immutable fake-Host serialization.
All four routes receive those same coordinates. The private six-page document
is never reflowed in the harness; authored-versus-CSS layout differences remain
visible. Comparison crops omit the editor's selection/frame-label overlay;
separate normal GUI captures retain the actual workbench chrome. Repeat-image
noise calibration and source/fixture hashes are part of each report.

During final review, `.canvas-meta` was found in the right-hand edge of some
wide-page comparison crops. It is editor chrome, not design content. The
comparison harness now hides it and the other named interaction overlays only
while taking comparison screenshots, checks that the active renderer remains
visible, and restores controls before UI interaction and normal GUI capture.
The `*-final` capture directories predate this correction and are superseded by
the complete `*-clean` recaptures. No design pixels were erased from existing
PNGs to make a gate pass.

## Final synthetic results

`finite-compatibility-clean.json` binds both reports to the same frozen fixture
SHA-256 `bbda319bcf38f119d17bb9c5380bd6b660fc78fd88351a1120c3e9bffd81a665`.
The full matrix is **not visually accepted**. A failing row is one
node/route/tile/matrix combination with one or more failed gates, not a unique node
or a count of individual pixels.

| Matrix | Candidate failing rows |
| --- | ---: |
| DPR1, zoom1 | 4 |
| DPR2, zoom1 | 30 |
| DPR1, zoom2 | 19 |
| DPR1, zoom0.5 | 42 |
| Total | 95 |

The frozen base has 255 failing rows; the candidate has 95, plus 19 failing
diagnostic comparisons among 60 diagnostic comparisons. There are no missing,
partial or unavailable primary measurements in this synthetic matrix. All 12
finite-offset controls have identical base/candidate SVG fragments and actual
GPU crop SHA-256 values, including native Inter and raster Arial. Every
HTML/HTML and GPU/GPU repeat comparison has zero noise.

Remaining valid primary failures are four Inter/range centroid cases (maximum
absolute delta 0.8084 device px against 0.75) and four scalar-shadow centroid
cases (maximum 1.2239 device px against 1). The secondary gate additionally
detects native Inter/range glyph pixels, rounded stroke seams and scaled/half
zoom raster differences. For example, at 1x1 native Inter mismatch is 2.488%
with cluster 49; the colored ordinary range is 1.983% with cluster 29. Optical
sizing reduced the former from 4.21%/232 but did not make it pass.

An early black-only foreground estimator falsely reported a colored range's
left edge as -8px. It now uses the minimum residual across the authored fill
palette; unchanged PNGs were remeasured with an audit record. The final clean
capture uses that corrected estimator. Its 1x1 range bbox differences are zero,
while the actual pixel failures remain visible. No threshold was changed.

`candidate-lines-strict-clean/report.json` is the bounded green result: 15 text
cases at DPR1/zoom1 through all four actual paths, zero failures, diagnostics,
unavailable metrics, partial nodes, missing nodes or font omissions. The GPU
report proves 15 raster text nodes. The same subset has 28 failing rows in the
frozen base and zero in the candidate. This does not waive the larger red matrix.

## Final six-page results and screenshots

`real-comparison-clean.json` and `evidence-summary-clean.json` verify matching
source/serialized hashes, viewport, font availability, Chromium and chrome
exclusion. Each side has 44 tiled comparisons across all six pages. All 232
text nodes use the actual GPU raster path; all 101 legacy stroked nodes have
local measurements. The source was never reflowed or written.

Each cell below is **base → candidate failing rows**.

| Page | DPR1 / zoom1 | DPR2 / zoom1 | DPR1 / zoom2 | DPR1 / zoom0.5 |
| --- | ---: | ---: | ---: | ---: |
| web-chat | 288 → 75 | 288 → 190 | 158 → 109 | 162 → 98 |
| ios-chat | 80 → 19 | 80 → 51 | 82 → 53 | 79 → 47 |
| android-chat | 80 → 19 | 80 → 51 | 120 → 80 | 79 → 47 |
| web-panels | 320 → 81 | 320 → 225 | 180 → 124 | 171 → 100 |
| ios-panels | 78 → 18 | 78 → 49 | 78 → 48 | 76 → 44 |
| android-panels | 82 → 21 | 82 → 52 | 112 → 76 | 80 → 47 |

Totals: **3233 → 1724** failing rows; GPU **1623 → 1203**, SVG **1610 → 521**,
browser/HTML **0 → 0**. All 44 browser-versus-HTML whole-image comparisons on
each side have zero mismatch. All repeat noise is zero; route errors are zero.

There are 7192 route/node/tile/matrix measurements per side. Unavailable primary
measurements are **232 → 234**; diagnostics number 688, with **284 → 127**
failing diagnostic comparisons. Forty-two node/matrix entries have no tile
containing their complete bounds; their visible segments are measured and
explicitly marked partial. No requested node is wholly missing. These figures
prevent a complete visual acceptance claim even independently of failed gates.

Candidate measured primary violations include 202 stroke-centroid violations
across 30 node IDs (worst absolute delta 2.336 device px), 110 stroke-width
violations across 21 IDs (worst deficit 1.195), and 242 text-centroid violations
across 48 IDs (worst absolute delta 1.460). One text ROI has top/bottom outliers
up to 9px. These counts include repeated tile measurements. Real-document ROIs
can contain nearby or child ink: these are retained failed measurements, not a
claim that every outlier has already been isolated to a renderer defect.
Secondary failures remain in 1194 GPU and 387 SVG rows; worst mismatch ratio
is 19.008%, and the largest observed cluster is 196. No authoring compensation
was applied to icons, selector formulas or disabled appearance.

All paths below are relative to the temporary evidence root, outside the
commit. Replace `{page}` with any of the six IDs in the table and `{matrix}`
with `dpr1-zoom1`, `dpr2-zoom1`, `dpr1-zoom2` or `dpr1-zoom05`:

- Aligned actual-editor crops and exports:
  `candidate-real-clean/{matrix}-{page}-{tile}/gpu.png`, `browser.png`,
  `svg.png`, `html.png`; adjacent `metrics.json` contains per-node statistics.
- Normal workbench GUI context:
  `candidate-real-clean/{matrix}-{page}-0/gpu-editor-gui.png` and
  `browser-editor-gui.png`. These are captured before alignment and can show
  auto-fit zoom (for example 66%) versus 100%; they are not the pixel-gate
  inputs. Only the aligned four `mode.png` files have identical measured zoom.
- Exact base counterparts use `baseline-real-clean` with the same suffix.
- `evidence-summary-clean.json` lists and verifies all 48 candidate GUI paths
  and 96 first-tile four-route paths, in addition to the complete 44-tile reports.

Codex inspected the clean web-chat four-route crops and both actual GUI
captures, plus representative GPU/HTML crops for web-panels, ios-chat and
android-panels. This was a representative inspection, not an assertion that
all pages/zooms were visually approved. Local font evidence proves PingFang is
available and used; it was not skipped. The harness now reports missing
requested fonts as `fallback-only` omissions and rejects a strict pass in that
case. The final strict line run has zero omissions. Full clean reports made
before that extra CI guard still record all required local fonts as available.

## Deferred scope

Complete mixed-typography range reconciliation and inline editor offset behavior
remain a subsequent round. This round must preserve their prior behavior and
report any discovered regression. Authoring defects in the six-page reference
(icons, selector formulas, disabled state) are not compensated by renderer edits.

## Reproduction

Run from the task worktree with its independent npm dependencies. The harness
does not use `test:fidelity:real`. Each command launches private Chromium
contexts, serially, at a maximum viewport of 1600x1000 and DPR2.

```sh
# Frozen base, strict: expected to fail the original visual regressions.
DESIGN_FIDELITY_APP_DIR=.tmp/render-fidelity-r001/base/apps/design-studio/app \
DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r001/baseline-clean \
node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs

# Full candidate matrix: diagnostic exit 0 is NOT a visual acceptance result.
DESIGN_FIDELITY_MODE=diagnostic \
DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r001/candidate-clean \
node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs

# Narrow, fully strict regression gate: actual GPU, browser, SVG and HTML.
DESIGN_FIDELITY_MODE=strict DESIGN_FIDELITY_PAGES=lines \
DESIGN_FIDELITY_MATRIX=dpr1-zoom1 \
DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r001/candidate-lines-strict-clean \
node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs

# Add this opt-in input to each base/candidate diagnostic matrix command.
DESIGN_FIDELITY_REAL_FIXTURE=/Users/admin/.codex/worktrees/codeshell-cross-platform-design-20261106/designs/codeshell-web-refined.backup.json \
DESIGN_FIDELITY_MODE=diagnostic \
DESIGN_FIDELITY_EVIDENCE=.tmp/render-fidelity-r001/candidate-real-clean \
node --test --test-concurrency=1 tests/apps/design-studio/render-fidelity-ui.test.mjs
```

The full strict visual harness remains an explicit acceptance command. It is
not silently skipped or relabeled green by the default functional suite. The
default suite includes metric fault injection, line-box/receipt compatibility,
font-baseline UI probes and legacy/explicit stroke UI regressions.

## Functional verification

The first complete functional batch was intentionally retained as a failure
record (`design-suite.log`: 1172 tests, 1164 pass, 7 fail, 1 skip). It exposed
native soft-wrap provenance consumers, old border/bounds expectations and a
generated plugin dependency inventory. The fixes preserve historical finite
signatures, add both old/new origin regressions, and regenerate the affected
bundled outputs. No unrelated suite was edited.

The next full run (`design-suite-clean.log`) passed all 1177 non-optional tests
in its first batch, then exposed one old GPU UI oracle that exported an
unmeasured SVG in Node. The reference now comes from the same loaded browser
font context and must explicitly be measured alphabetic output. All original
MAE-improvement, 1px bbox and maximum-channel-128 assertions remain unchanged.
The complete GPU UI file then passed 6/6: actual GPU MAE 0.002177734375 versus
master 0.17968587239583333, maximum channel delta 1.

| Command | Result / evidence |
| --- | --- |
| `npm ci` | Independent worktree dependencies installed; no node_modules symlink |
| `npm run typecheck` | Exit 0, `typecheck-clean.log` |
| `npm run validate` | Exit 0, `validate-clean.log` |
| `npm test -- --suite design-studio` | Final exit 0: 1394 total, 1389 pass, 0 fail, 5 existing opt-in skips; `design-suite-final.log` |
| `npm run validate` (delivery rerun) | Exit 0, `validate-delivery.log` |
| `npm run check` | Exit 0 across the complete offline catalog and source/build/package checks, `check-final.log`; no unrelated failure or suite modification |
| `node scripts/build-design-studio-figma-plugin.mjs --check` | Exit 0, `figma-build-verify-clean.log` |
| `node scripts/build-design-studio-html-plugin.mjs --check` | Exit 0, `html-plugin-build-verify-clean.log` |
| `node --test --test-concurrency=1 tests/apps/design-studio/figma-plugin.test.mjs tests/apps/design-studio/html-plugin.test.mjs tests/apps/design-studio/native-text-content.test.mjs tests/apps/design-studio/design-compare.test.mjs tests/apps/design-studio/infinite-canvas-release-compat.test.mjs` | 153/153 pass, `consumer-regressions.log` |
| `node --test --test-concurrency=1 tests/apps/design-studio/gpu-renderer-ui.test.mjs` | 6/6 pass, `gpu-renderer-ui-oracle.log`; original pixel assertions retained |

The five default-suite skips are the pre-existing optional prepared Grida
encoder round-trip, an optional real portable renderer input, and three private
IANA asset cases (`IANA_FONT_ASSETS_DIR` is not supplied). No requested local
PingFang case is skipped. The requested six-page portable input was instead
explicitly exercised by the new read-only four-route harness, at all four
matrix settings. Optional private IANA assets and an unprepared third-party
encoder are not represented as tested.

Codex collaborators additionally reviewed origin/cache/import consumers and
compared mixed-typography base/candidate serialization, SVG, page bounds, ink
bounds and signatures for absent/zero/negative/positive offsets. These checks
do not constitute the requested subsequent same-session CC review or establish
mixed-typography pixel parity.
