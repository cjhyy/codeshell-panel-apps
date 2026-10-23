# Preserve native pixel line-height intent

The actual add2958c production Text Grid roundtrip from frozen a4e5dd91 source preserves 57 nodes, all geometry and numeric typography, and byte-identical initial native PNGs. Independent analysis nevertheless found every real Text changed REST `style.lineHeightUnit` from `PIXELS` to `FONT_SIZE_%`. At font size 16 the 20/30px values agree, so the initial image cannot prove future font-size-edit semantics. The frozen evidence is `evidence/real-figma/native-text-grid-roundtrip/independent-analysis` outside Git. Original receipts and initial strict pixel proof remain unchanged.

The loss begins in `figma-bridge.mjs`: every `lineHeightPx` becomes a font-size ratio. The current v3 codec/schema only stores that ratio, renderers multiply it by font size, and native creation/patch setters always use PERCENT. A setter-only change would disagree with panel edits.

## Bounded extension

Add optional text-only `lineHeightUnit: "pixels"`. When present, the existing `lineHeight` scalar means physical pixels. Absence preserves the exact legacy ratio interpretation, validation, source binding, rendering and native PERCENT setter. No existing document is migrated. Pixel bounds derive from the existing supported font/ratio envelope: minimum `6 * 0.7 = 4.2px`, maximum `240 * 3 = 720px`. Ratio values remain 0.7–3. Unknown units, non-finite values, non-text placement and out-of-range pixel values fail validation. Native import opts into pixel intent only for explicit PIXELS with finite supported values; invalid explicit source values receive an actionable diagnostic and do not gain trusted pixel intent. AUTO/intrinsic line-height support is not inferred.

A small pure helper supplies effective pixel advance, equivalent ratio, native setter value and validation. Layout/measurement signatures, text metrics, SVG, CanvasKit, frontend CSS, inline editor and audit use that helper. Pixel frontend CSS uses `px`; legacy uses unitless ratio. Inspector value/range and unit selector preserve physical appearance when deliberately switching units. The source binding, public edit/delete allowlist, serializer, portable codec, compare, native preflight/create/patch and source snapshots preserve the optional unit. Native raw source remains the authoritative concurrent-edit guard.

The bounded intrinsic Grid exception still applies its existing effective-ratio guard (0.7–3) and all original content/cycle restrictions. This change does not widen table parsing, mixed typography, AUTO line height, horizontal cycles or unsafe Fill rectangles. Existing source-only and measured fallback behavior remains explicit.

## Validation and risk

The main semantic control is font size 16→24→16 with a pixel20 line height remaining20 versus legacy ratio1.25 advancing20→30→20. Test real measurement, full Text source, row/cell heights, serialization/reopen, portable conversion, undo/copy, native VM creation and source patching, and concurrent style conflicts. Legacy ratio and invalid unit/value tests remain strict. Same-font CPU Chromium SVG/frontend tests use `--disable-gpu`; no native/UI/GPU actions by this task. Root runs a separate actual native font-size-edit control after review. The existing initial PNG0 result alone is insufficient.

Risks are missed multiplication sites, stale metric/cache receipts, orphan optional units in copied/patched nodes, or silently changing the unit when editing font size. Older plugins reject pixel scalars above their ratio limit and must be updated with the new source/generated outputs. No broad text rewrite or HTML capture intent expansion is included.

Primary API references: https://developers.figma.com/docs/plugins/api/LineHeight/ and https://developers.figma.com/docs/rest-api/file-property-types/#typestyle-type . The plugin LineHeight union distinguishes PIXELS/PERCENT/AUTO; the REST TypeStyle exposes the corresponding lineHeightUnit and resolved pixel value.

## Delivered checks

The final affected CPU gate passes 184/184 tests, including the actual native Text/Grid fixtures, source binding, native VM creation and reviewed patches, portable/save codecs, signatures/content provenance, frontend/SVG strict pixels, and audits. Its explicit Playwright preload logs every launch with `--disable-gpu`; timestamps and full output are retained in external `evidence/native-text-lineheight-unit/final-cpu-targets.json`. Typecheck, manifest/application validation, native packaging/build check, and all three generation checks pass. The standalone HTML plugin UI bytes remain unchanged while its input-provenance inventory now includes the new helper; its maintained builder was run and verified.

Peer source review found and verified fixes for three edge cases: bounded nine-element pixel metric signatures must retain authored newline provenance; physical pixel import must not depend on a rounded ratio (including20px at font19 or40); and the public Host input schema must admit the optional unit/coherent partial bounds. Existing eight-element ratio signatures remain byte-identical. New malformed signature/unit/value and source-concurrency controls pass.

An earlier 157-pass run used a pre-existing plain Chromium launch and is explicitly excluded from CPU-only evidence. Its original command/duration and available timestamp bounds are retained in `initial-157-noncpu-run.json`; the immediately preceding file-write timestamp21:33:25.200662Z is after root's21:30:08–21:30:35 native run, so the runs did not overlap. Exact UTC start/end were not emitted by that original command and are not invented. The final184-test run supersedes it for CPU verification.

The inspector font/unit/undo/duplicate/reopen UI regression is included for root's combined GPU/UI gate. This task did not run it or native Figma. The add2958c initial native PNG proof retains its original unit-loss limitation. Root must separately rerun production roundtrip with PIXELS assertions and native16→24→16 font-size edits before claiming the unit fix is proven in Figma. Native-versus-CSS/SVG font raster parity remains unverified.
