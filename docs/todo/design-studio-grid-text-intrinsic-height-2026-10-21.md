# Bounded native Grid intrinsic height from real Text

The owned native research run `a4e5dd91` extends the rectangle evidence in
`design-studio-grid-intrinsic-height-2026-10-21.md`. Eight cases and seven stages
retain every real opaque cell/Text layer. All 392 row/cell/Text absolute boxes
match live getters and official REST JSON exactly. All 168 Text records retain
raw original/edited characters and H-FILL/V-HUG/HEIGHT modes. The source result
SHA is `6dd1cc6d09c5f5d0bd391d538a6255fef61fecadf263cf3f597eb0d072c931d6`.

A HUG row with V-FILL cells responds 40→80→40 when the real text changes from two
to four explicit lines and back, including both affine setter orders. Wrapping
text at widths 630/708/483.328125/390/630 produces equal-column row heights
80/60/100/120/80 and affine row heights80/80/100/140/80. Final getters return
exactly to their initial values. No edit repairs row, cell or text height/modes.

The actual JSON fixture retains source geometry/styles/characters. It adds only
exact live Grid arrays/anchors that JSON_REST omits, matching production
`preserveNativeGrid`; `tests/fixtures/design-studio-grid-text-intrinsic-height/`
records raw/official/derived SHA provenance and each supplemented field.

## Model boundary

The existing parent/cell predicate remains unchanged: one HUG row, definite Grid
horizontal extent, validated FIXED/FLEX columns, real VERTICAL H-FILL/V-FILL cell,
no extra flow content, spans across rows, vertical padding/gap, wrap/reverse,
stroke participation, explicit size constraints, hidden/absolute content or
rotation. The new accepted leaf is ordinary single-style H-FILL/V-HUG Text with
raw `textSource` and wrap intent, zero letter spacing, left alignment and no text
decoration or truncation. Existing schema typography/size/text bounds apply.

The contribution is the real Text's logical line-box height. The existing
bounded eight-pass reverse-Hug/forward-flow/responsive-text sequence resolves
cell width first, measures its real text at that content width, then updates the
Grid's intrinsic height on the next pass. It never uses a stretched cell height
as the intrinsic contribution. Tests cover deliberately stale cell heights,
scoped edits requested from the Text ID, copy grow/shrink, width wrapping and
save/reopen. No generic Text measurement, native creation/patch ordering, schema
or persisted-field change is required.

A capture-local WeakSet prevents raw mixed style runs, list markers/line indentation, paragraph spacing/indent,
non-top/left alignment, transformed case or truncation from qualifying merely
because current text conversion flattened the style. Such Grid sources keep
measured fallback and explicit `unsupported-grid` diagnostics. The original raw
source remains in the binding; no new canonical proof field is persisted.

Empty/basic Fill rectangles, missing or empty raw text source, V-FILL text cycles,
fixed-height/intrinsic-width text, ellipsis, decorations, extra descendants,
spanning/multirow and horizontal HUG cycles remain rejected. Unsupported fallback
retains the existing direct-relationship cleanup and nested own Grid behavior.

## Validation and limits

The new CPU browser fixture loads the repository's exact InterVariable bytes in
both independent CSS and canonical rendering, checks the loaded FontFace and real
measurer, and requires byte-identical DPR1 SVG/frontend PNGs at integer 630/390
widths. Direct exported DOM character/width edits also retain real full-height
colored cells without a canonical height update. This verifies these browser
surfaces with the same known font; it does not prove Figma uses identical font
bytes/version. Native PNG comparison is NOT_RUN. Native glyph/font parity and
known fractional native/Chromium raster discrepancies remain explicit limits.

The production-plugin VM checks preflight, actual node hierarchy, raw characters
and modes, not font measurement. Its Grid capability mock now reflects the
observed legacy STRETCH ↔ modern cross-axis FILL alias for nested text; an absent
mock alias must not be mistaken for a production setter defect.

This change adds no table parser, inferred media-query response, fake sizing
layers or ordinary absolute flow. Native production acceptance remains a
separate root-owned execution after integration.

Primary API references:

- https://developers.figma.com/docs/plugins/api/GridTrackSize/
- https://developers.figma.com/docs/plugins/api/TextNode/
- https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync/
- https://developers.figma.com/docs/plugins/working-with-text/
