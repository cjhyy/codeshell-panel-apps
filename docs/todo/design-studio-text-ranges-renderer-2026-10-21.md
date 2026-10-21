# Bounded paint/link range consumers

The approved v1 contract keeps one canonical editable Text with source-index paint,
decoration and link overrides. This renderer task consumes the shared
`text-ranges.mjs` projection; it adds no capture admission, schema field, native
setter, glyph position, font replacement or bitmap scene.

CanvasKit retains the existing supplied-font SkParagraph default. Ranged paint
uses one ParagraphBuilder per existing complete display line, with identical
metric styles and foreground paints selected by the source/display projection.
It never shapes individual fragments or switches supplied text to the browser
raster cache. Empty range lists and absent payloads retain uniform behavior.
Existing node-picture signatures already include the complete node/range payload.

The pinned Paragraph API cannot express exact CSS underline offset or skip-ink;
its thickness input is a font-metric multiplier. Explicit custom thickness,
offset or skip-ink therefore throws `TEXT_RANGES_UNSUPPORTED` before drawing.
Missing supplied fonts/glyphs, ranged multilayer fills and ranged strokes also
refuse. The existing controller failure path shows a bounded range-text reason
and retains the saved data. It does not show a successful/partial fidelity result
or mislabel this as hardware failure. Legacy/default decoration remains the
existing Paragraph behavior; it is not a custom CSS equivalence claim.

Frontend export uses the complete authored source in normal inline spans/A so
browser wrapping responds to future width/copy/font edits. Saved display soft LF
never becomes a source/link character. The parent carries no decoration when
ranges are active, allowing an effective `none` range to cancel a scalar base
underline. Effective run decorations use exact approved px/em/auto CSS and
skip-ink values. Missing fill inherits the parent color; explicit equal fill
remains explicit. Contiguous source fragments with identical present overrides,
effective style and href coalesce, including authored LF, preserving one anchor
and keyboard target per continuous link. Literal safe href and text are escaped.

CPU-only validation uses Chromium with `--disable-gpu`:

- Whole-line supplied Inter Paragraph controls across AV, fi, combining-mark and
  LF/NBSP boundaries preserve exact glyph advance/cluster geometry. Same-color
  range splits have strict0 RGBA differences from the uniform Paragraph; different
  foregrounds keep the same shaping. Font resources/source remain unchanged and
  raster cache images/bytes stay0.
- Seven actual frontend DOM width/copy/font/base-color stages compare strict0
  against separately authored CSS/HTML with1px underline,0.1578em offset and
  skip-ink:auto. Source LF/NBSP and one continuous anchor remain intact.
- Custom CanvasKit decoration refuses through the real controller callback and
  actual app status-message function. Negative tests assert unsupported fields
  do not mutate inputs and do not invoke drawing.
- A first controller test mock lacked required resize/render methods; its failure
  log is preserved. Adding the required mock interface reaches the intended
  refusal path; no wait or product adjustment was used.

Controlled CPU artifacts are under the task worktree's external parent
`evidence/cpu-v5/`; root keeps the delivery receipt after merge. These are consumer
regressions, not HTML capture or actual WebGL editor acceptance. No GPU/native
trial was run by this task. Agent1's explicit SVG geometry222/400-pixel negatives,
the supplied-alias underline2737-pixel negative and native literal# rejection
remain separate failures. HTML positive admission stays closed until every
consumer and native boundary has a proven supported contract.
