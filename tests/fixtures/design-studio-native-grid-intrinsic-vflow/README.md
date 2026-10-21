# Native nested paragraph Grid evidence

These fixtures preserve the actual Figma run `0172eaef` from 2026-10-20,
created by the owned-page `native-table-multi-p-probe.mjs` research harness.
The production base was `462e735716f23eb2f2663c741d7a8192573beb4a`.
`provenance.json` records the immutable raw, official, production supplement,
and derived fixture hashes and the exact supplemented fields. Source IDs,
hierarchy, transforms, geometry, typography, and characters were not rewritten.

The 27 native layers include the page. The 26 non-page layers preserve four
row Grids, eight real cells, nine Text nodes, two real paragraph frames, and
the captured margin wrapper. The contact cell is a vertical FILL frame whose
children are `wrapper(P(Text))` and `P(Text)`. Every paragraph and wrapper uses
vertical HUG sizing. The owner has a fixed resolved width; each row uses
horizontal FILL and vertical HUG with one HUG track and real FILL cells.

`native-stages.json` retains every measured box at width 1220, phone growth
from one to four explicit lines, shrink to one line, width 708, and return to
1220. All vertical geometry is exact: contact row 81→156→81, first paragraph
25→100→25, margin wrapper 36→111→36, and owner 269→344→269. Native official
JSON, SDK geometry, and PNG bytes returned exactly after both edit cycles.

The original strict report remains false in `native-residuals.json`: 45 SDK
font-object augmentations and 32 horizontal geometry differences at width
708. Native columns are 232.40000915527344 and 475.6000061035156; the ideal
affine model is 232.4 and 475.6, while frozen CSS yields 232.390625 and
475.609375. No tolerance, geometry correction, or font-byte equivalence was
introduced. This receipt proves bounded intrinsic vertical flow, not full
GOV.UK glyph or fractional-column pixel equivalence.

Complete raw, official, PNG, restoration and independent audit receipts are
archived outside the checkout in the task aggregate's
`evidence/native-table-multi-p-analysis/actual-0172eaef/`. The original
transparent-cell collapsed-edge paint and opaque-cell negative control remain
separate. The existing frontend exporter explicitly refuses non-INSIDE
independent side strokes; this change does not broaden HTML table capture or
CSS paint support.

`fill-context.mjs` is a separately labelled CPU control, not a new native
receipt. It clones this saved content into a vertical body with padding30 and
a fixed-width vertical outer frame, changes the table owner to horizontal
FILL, and translates its source geometry by(-10,-10) for the new inset. The
immutable actual JSON is unchanged. Tests resize only the outer frame
1280→768→1280 and edit the nested paragraph; real parent references prove
resolution through the Fill chain. Hug, missing, cyclic, constrained,
transformed, reversed, wrapped and stroked intermediate owners refuse. A new
lookup is built for every operation, including valid reparent/save/reopen.
