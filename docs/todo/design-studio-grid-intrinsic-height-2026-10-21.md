# Bounded native Grid intrinsic row height

This patch preserves a proven vertical dependency: one HUG Grid row can derive
its height from real nested content while its opaque cell frames remain V-FILL.
It adds no document fields and does not add a table parser or admit Text leaves.

The owned native run `native-grid-height-2026-10-20T20-18-22.755Z-289e088a` contains
8 cases × 7 stages, 58 new nodes and no setter errors. Both setter orders preserve
HUG/FILL getters and full cell backgrounds through content height 40→80→40.
All 392 row/cell/content boxes match live getters and official JSON exactly.
A fixed 500px child overflows without expanding the FLEX tracks. Original page,
selection and existing child IDs remain unchanged; root closed the plugin and
verified exact restoration of the three registered files.

The fixture is actual official JSON plus the exact live Grid property supplement
used by production `preserveNativeGrid`. JSON_REST_V1 omits track arrays; raw
`gridColumnsSizing` strings are not parsed or guessed. Fixture provenance records
both raw source hashes. The imported document retains all 57 real design nodes
(the native Page is represented as the design page).

## Supported boundary

Only a single explicit HUG row with a definite horizontal extent and validated
FIXED/FLEX columns is eligible. A cell is a VERTICAL Frame with explicit H-FILL /
V-FILL, rowSpan 1, zero vertical padding/gap, no stroke/constraints/rotation/reverse,
and exactly one visible AUTO rectangle with a positive finite FIXED height.
The rectangle may be H-FILL or fixed width, including the real overflow control.

Empty frames, basic Fill rectangles, horizontal HUG-column cycles, V-FILL leaf
cycles, Text/HUG leaves, multiple content children, spanning rows and unsupported
style/constraint cases retain the existing actionable rejection. A separate
native Text HUG/FILL control is required before extending toward table text.

## Implementation and validation

The shared helper reads the actual leaf height, never the previous stretched
cell height. Vertical track measurement, scoped parent dependency discovery and
frontend CSS use this same bounded predicate. Flat descendants are resolved only
after the parent/cell eligibility check. Cell modes are never temporarily changed
to HUG. Figma import validates complete converted children; fallback removes only
rejected parent relationship fields and preserves a child's own nested Grid.

The new tests cover actual source import, native plugin preflight, source/reopen,
stale cell heights 80/170, scoped content edits, 630→390→630 widths, fixed 500px
overflow, nested fallback cleanup and unsafe-cycle controls. An equal-track native
fixture also passes strict SVG/frontend pixels and direct exported CSS height
edits. The related CPU target passed 147 tests; typecheck, validation and generated
plugin/browser/build checks passed. Root owns subsequent actual production/native
acceptance; no registered plugin files were changed by this task.

## Retained fractional failures

An independent authored CSS whiteboard (not website capture or production
acceptance) compared all seven raw native PNGs with no threshold. Changed pixels:
`[0,0,0,240,660,0,0]`; maximum channel deltas `[0,0,0,77,76,0,0]`.
W708 and W483.328125 remain strict failures. At W708 the key cell width is
232.40000915527344 native versus 232.390625 Chromium; at W483.328125 it is
164.99844360351562 versus 164.984375. No values were snapped or rounded to hide
these differences. Raw/reference/diff PNGs and full-precision boxes remain in
`evidence/native-grid-intrinsic-height-analysis/actual-289e088a-css-reference`.

Official API context: [GridTrackSize](https://developers.figma.com/docs/plugins/api/GridTrackSize/)
and [Grid auto layout](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow).
The docs describe content-sized tracks; actual nested Fill capability above is
supported by the native run rather than inferred from those general descriptions.
