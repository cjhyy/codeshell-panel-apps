# Bounded floated-column flow recovery

Base: `93885d4`. Own isolated branch/worktree; root owns Figma UI and GPU gates.
No new canonical fields, arbitrary CSS execution or synthetic painted children.

## Evidence and failure

Frozen GOV check-answers has a `.govuk-grid-row` with auto width, -15px left/right
margins, one left-floated two-thirds column, and an empty zero-height block
`::after` with `clear:both`. At a 1280px viewport the row is 990px, the column is
660px and its horizontal padding is 15px each. Typed OM retains `66.6667%`.
Below 769px the public CSS changes the column to `float:none;width:auto`.
The [GOV layout documentation](https://design-system.service.gov.uk/styles/layout/)
explicitly describes this desktop-only fraction. This task captures the active
CSS state, and will not invent or execute media-query rules on native resize.

The pinned converter marks the row `hasFloatChildren`, suppresses ordinary block
postprocessing, emits its zero-height clearfix as a child, and converts the
negative-margin row to absolute plus an inert flow placeholder. Current negative
bleed recovery already finds that exact placeholder and restores the row's outer
flow. Its inner float row and column remain Freeform because floats are rejected
by the ordinary block planner.

Minimal same-state isolated 2/3 float baseline: imported / same-width / 400px
resize = **0 / 0 / 15000** differing pixels, max channel 201. Its existing generic
semantic harness misleadingly reports no issue because it checks the outer root.
The new regression must inspect the actual source row/column and native transfer.
Frozen complete GOV same-base baseline at 1280x768, viewport-only narrow768:
**27203 / 27203 / 62622**, all strict failures. All source/CSS/fonts remain intact.
Raw inventory, baseline failures and receipts are retained under aggregate
`evidence/html-float-columns/`. The first misconfigured corpus invocation ran
default fixtures; its directory is retained with an explicit attempt note.

## Existing semantic representation

A source block/flow-root container with only isolated floated column boxes can
map to one native Grid row using the existing validated Grid fields. Recover each
positive percentage as an exact rational with denominator at most 24 (within Typed
OM serialization rounding); combine denominators only when the common count is
at most 24. Tracks are equal FLEX1 and each column fills its authored span. Fixed
padding stays on the column. Unoccupied tracks stay empty; no placeholder layer
is needed. Preserve DOM child order and assign explicit native Grid anchors.
All columns must have the same float direction, occupy the same measured row,
fit without overlap/wrap, and have zero margins and no min/max/shape/offset rules
that would change this relationship. Percent content-box columns with horizontal
padding/border are rejected. Actual measured geometry must agree with the plan.

Recognize only a proven empty, unpainted, zero-height generated clearfix as a
structural sentinel, never by name alone. It becomes the Grid row's ordinary
height ownership. The same inert sentinel can be omitted when a separate capture
has switched its columns back to normal block flow. Original source indices and
IDs remain attached to real elements.

A proven float column may recover its own ordinary block children through a
narrow outer-float opt-in in the existing block planner. Its parent determines
the column placement; its descendants retain their own block/inline/table checks.
Existing negative-bleed wrapping remains responsible for the row's outer margins.

## Explicit limits and rollback

Mixed inline text, float-around text, shape-outside, clear on real columns, mixed
float directions, multiple float lines, nonrational percentage widths, min/max or
content-box additions, transformed/offset/absolute source boxes and missing
reliable capture metadata retain measured geometry with actionable diagnostics.
The [CSS float rules](https://www.w3.org/TR/CSS2/visuren.html#floats) include inline
line-box exclusion and packing behavior that this bounded mapping does not model.

Every recovered row warns that native Grid retains the current captured CSS
state, with no breakpoint/float-wrap behavior. A resize crossing the GOV desktop
breakpoint must remain a recorded strict failure. No widened pixel gate and no
claim of solving its collapsed table rows, mixed text or viewport boundary.
If child conversion or final native Grid validation rejects the plan, remove
only this parent's Grid/child-placement fields and restore initial sizing;
retain nested children's own Grid container fields and all measured geometry.

## Validation plan

Strict real-browser production capture, save/reopen, ordinary resize and frontend
export for integer-position left/right fractions, multiple columns, negative bleed
and ordinary inner blocks. Assert actual row GRID, explicit counts/spans/FILL,
column vertical Auto Layout, no absolute original flow elements and no fake
painted layers in native transfer. Unit tests reject malformed/unbounded plans,
unsupported children and missing metadata. Capture breakpoint and unsupported
patterns with explicit warnings and honest nonzero counts. Run final source
checks and rebuild the browser/Bridge/standalone generated artifacts. Native
creation currently has a root-owned stroke setter-order prerequisite; no Figma
UI or native parity claim is made by this agent.

## Source and native evidence boundaries

The implemented minimal left 2/3 + bleed, right 1/4, left/right split 1/3+2/3 and flow-root
fixtures pass strict **0 / 0 / 0** after capture/save/reopen/resize, with exact
HTML export at both widths. Editing the inner fixed height also updates the HUG
column and Grid row with exact SVG pixels. The actual source row/columns and
transfer are explicitly checked; the generic outer-root semantic check alone
is insufficient.

The explicit desktop-breakpoint fixture retains **0 / 0 / 12000** differing
pixels and a failing strict report after crossing its breakpoint. Separately
capturing that source in its mobile block state passes **0 / 0 / 0**. Final
screenshots, complete files, plugin inputs and receipts remain in
`evidence/html-float-columns/{minimal-final,breakpoint-final,final-receipt.json}`.

The complete frozen GOV sample now has a real Grid row and vertical Auto Layout
column, but still reports **27203 / 27203 / 62622**, unchanged from this base.
Its outer ancestor scroll boundary still triggers `viewport-flow-fixed`, and
768px crosses its 769px CSS desktop breakpoint. Tables and mixed text remain
diagnosed. No visible element or source CSS is removed to improve counts.

Root's separate live native negative-bleed proof found canonical row x5/width630
becoming native x20/width600 under the existing -16/1px spacer wrapper. Therefore
float+bleed's whole native geometry is explicitly **not verified/faithful** by
these SVG/HTML checks. The ordinary percentage Grid mapping is independent;
root owns the spacing fix/diagnostic and native acceptance after integration.
This branch does not change native spacing or Figma creation. The standalone
HTML plugin retains measured/manual float mapping with a persistent visible
percentage-flow loss warning.

For comparison only, root later measured aggregate `0118d17` with border/negative
spacing changes at **23329 / 23329 / 59515** on an identical decoded source image,
retaining 189 nodes and 58 warnings. That is a separate parent baseline, not a
result of this float branch. Its paired receipt remains at
`evidence/web-corpus/govuk-check-answers/round11-merged-border/paired-baseline-receipt.json`.
Root will measure the combined branch after integration.

## Completed checks

- First registered Design Studio main command: **467 passed, 1 existing skip,
  0 failed** (468 tests). The separate exclusive UI/CanvasKit command remains
  root-owned for the combined aggregate.
- Focused float + ordinary block tests: **9 passed**; standalone float warning
  UI/import regression: **1 passed**.
- `npm run typecheck`, `npm run validate`, `git diff --check`, scoped
  `build-panels --app design-studio --check`, and browser/Bridge/standalone
  generation checks passed. New helper and regression file pass Prettier checks.
- Browser bundle SHA-256:
  `c4bb09da0394ba068d526913e5a4b366cd56447a565b25efd0de10c9422005c7`.
