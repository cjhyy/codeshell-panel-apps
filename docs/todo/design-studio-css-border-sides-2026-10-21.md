# CSS border sides and alignment

Base: `d65e0f2`. This task owns border painting/metadata and the adapter's
`styleSurface` border block. Ordinary children stay in their existing Auto Layout.
Root owns actual Figma UI; the focused GPU validation window was released after its check.

## Evidence first

The frozen public GOV.UK check-answers sample has nine summary-list rows with
only a 1px solid `#cecece` bottom border, a footer with only a 10px solid
`#1d70b8` top border, a transparent 1px header bottom border, and a transparent
2px button border. All measured radii are zero. Summary rows use `display:
table-row` and collapsed table borders, so shared-edge placement is a distinct
unsupported semantic, not proof of ordinary inside border fidelity.

The exact computed values and source receipt are retained in the aggregate
worktree's `evidence/css-border-sides/govuk-computed-borders.json`. Browser input
uses the immutable local-assets snapshot; external requests are blocked.
Minimal strict baseline fixtures cover bottom-only borders, uniform inside
borders and unequal per-side colors/widths. Existing conversion paints the first
visible side as a uniform centered stroke, adding three unauthored edges.

## Bounded optional canonical data

Keep existing `stroke` / `strokeWidth` and their default centered semantics.
Add optional `strokeAlign: "inside" | "center" | "outside"`. Add optional
`strokeSides`, a fixed four-entry clockwise array (top/right/bottom/left), each
with only `{width, color, opacity}`: width 0–100px, six-digit RGB color, opacity
0–1. These are solid paints only. No CSS strings, external resources, arbitrary
path execution or synthetic document child layers.

`strokeSides` is authoritative when present; compatibility stroke fields do not
add another outline. CSS import sets inside alignment, retains alpha and zero
width sides, and preserves transparent borders' layout inset. Native/legacy
documents without the new fields remain unchanged. Runtime normalization,
published schema, Host schema, codecs, editable patches, comparison and palette
replacement must agree on the same bounded grammar.

Supported geometry subset: rectangular frame/rectangle/component surfaces, solid
side paints, zero corner radius for unequal side colors/widths; uniform rounded
inside borders use an outer/inner rounded ring. Unsupported dashed/dotted/double,
border-image, collapsed table joins and unequal rounded combinations retain
clear diagnostics. Scope can expand only after strict fixtures prove it.

## Paint and layout contract

Canonical padding already includes the CSS border inset. SVG and CanvasKit paint
inside the existing box without changing flow geometry. Frontend CSS must avoid
counting the border a second time: subtract inside border widths from the emitted
effective padding. Node opacity applies once to the complete fill + border group.
Border geometry affects visual bounds according to alignment; inside borders add
no outside extent. Old centered-stroke bounds remain unchanged.

For square corners, edge rectangles and corner base/overlay triangles interpolate
adjacent colors without a background seam. A common-alpha border is composited once
as a group, so corner overlap does not apply alpha twice. For a uniform rounded border, use one
even-odd outer/inner rounded ring. No fake absolute children enter the canonical
document or Auto Layout child list. Browser output continues to use native CSS
border properties for representable inside borders. It subtracts inside border
widths from effective padding and adjusts absolute-child coordinates for the CSS
padding-box containing block. Absolute children do not inherit flow stretch sizing.
Unequal non-inside borders and effective flow padding smaller than an inside
border receive explicit frontend export errors. Collapsed table rows retain
measured centered sides with an explicit loss diagnostic.

## Native boundary

[Figma RectangleNode](https://developers.figma.com/docs/plugins/api/RectangleNode/)
supports independent `strokeTopWeight`, `strokeRightWeight`, `strokeBottomWeight`
and `strokeLeftWeight`; zero hides one side. `strokeWeight` resets every side and
returns `figma.mixed` for unequal weights. The paints in `strokes` apply to the
whole outline. [strokeAlign](https://developers.figma.com/docs/plugins/api/properties/nodes-strokealign/)
supports inside/center/outside.

Therefore a single visible color/opacity with independent side widths maps to
real native stroke properties. Do not silently choose a color for a multicolor
border: fail native interchange explicitly before mutation while preserving the
editable v3 source. Native import/export supplements the actual side weights
when official JSON omits them. Border/style conflict checks remain active in
reviewed patches, including native joins, dashes and low miter limits. New structured
borders use solid MITER joins. Non-MITER/low-miter native joins are diagnosed.

Figma's `strokesIncludedInLayout` also changes effective padding. CSS-derived
copies use the existing total-inset padding with native stroke layout inclusion
disabled. Native INSIDE source import/patch projects that inclusion into the effective-inset
contract. CENTER/OUTSIDE inclusion retains measured geometry with an explicit
diagnostic, and included-layout border/padding patches reject those unsupported
alignments before mutation until actual native measurements establish the factors.

[Figma’s current Flexbox layout-version article](https://help.figma.com/hc/en-us/articles/42031586813719-Use-auto-layout-with-CSS-Flexbox-in-mind)
explains that modern frames count only INSIDE strokes and distribute Fill children
by content area; legacy frames remain available during the transition to January 2027. This task therefore does not infer CENTER/OUTSIDE inclusion factors or claim
that every layout-version/unequal-Fill combination has native parity. Root owns the
live alignment/inclusion probe before extending those claims.

## Validation

Strict real-browser capture/save/reopen/resize and frontend output, source color
and width edits, alpha joins, clipping, padding and Auto Layout child invariance.
Legacy strokes must retain existing output and bounds. Runtime/schema/Host
preflight reject invalid arrays, keys, widths and alpha. Native VM tests assert
real properties, no added children, raw roundtrip and external edit conflicts.
The focused GPU test passed: tile/direct pixels agree; zero sides, one alpha
composition at corners and edited picture invalidation are verified. Actual
native UI remains root-owned.

Full GOV.UK comparisons retain all elements, CSS, local fonts and exact strict
pixel counts. This task does not claim to solve its table layout, typography or
collapsed-border edge ownership merely by removing uniform-stroke artifacts.

## Measured outcome

External evidence is preserved in the aggregate worktree under
`evidence/css-border-sides/`, including the failed first implementation.

- Ordinary bottom-only, uniform inside and uniform-alpha borders: strict
  capture / same-width relayout / narrow resize = **0 / 0 / 0** differing pixels.
  The absolute-overlay border fixture also passes **0 / 0 / 0**, and their
  exported HTML matches the source exactly at both widths.
- Baseline bottom-only was 3136 / 3136 / 2176; uniform inside was
  6208 / 6208 / 4288. Source children remain ordinary Auto Layout children.
- Multicolor unequal square joins remain **12 / 12 / 12**, max channel 1;
  common-alpha unequal joins remain **4 / 4 / 4**, max channel 1. These are
  retained strict failures, not passing fidelity claims.
- Structured square CENTER/OUTSIDE SVG and HTML match an equivalent CSS outline
  exactly. Tiny fully filled rounded border geometry has no inner hole, but SVG
  versus CSS rounded edge rasterization retains 2 differing pixels, max channel 7;
  the geometry regression records this difference without widening a pixel gate.
- Frozen complete GOV sample, controlled same-base A/B: initial/same/narrow
  changed pixels decrease from **27203 / 27203 / 55239** to
  **23329 / 23329 / 51720**, max channel 255. It still fails strict fidelity and
  retains all nine collapsed-border warnings plus the existing flow issue.

The standalone HTML plugin keeps its existing centered uniform border mapping
with a persistent visible compatibility warning across preview, downloaded JSON
and native import. Its generated package does not claim the new workbench border
fidelity. Production limits and network policy are unchanged.

Final checks: first non-GPU `design-studio` suite command from `tests/suites.mjs`
passed **453**, with **1 existing skip**, **0 failures** (454 total). The focused
CanvasKit border regression passed **1/1**. `npm run typecheck`, `npm run validate`,
all three browser/Bridge/standalone generated-output `--check` commands and
`build-panels.mjs --app design-studio --check` passed. Full GPU/UI acceptance is
left to the aggregate's root-owned exclusive gate; no actual Figma UI action was
performed by this agent.
