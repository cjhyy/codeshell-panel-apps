# Native centered excluded row Grid fixture

Root's actual native run `f4568ae6` created one owned page with three vertical
width owners, nine preserved Grid rows, 27 real full-size cell Frames and 27
real Texts. `native-source.json` is the official initial export plus the exact
production `preserveNativeGrid` supplement from the same archived SDK getters.
Source IDs, boxes, characters, styles and hierarchy remain unchanged. Provenance
includes raw/official/first exact analysis hashes and every supplemented field.
The original complete raw receipt, five official exports/PNGs and independent
analysis remain in the task evidence journal outside Git.

The supported native dependency is one HUG row, fixed/flex columns, fixed or
bounded resolved Fill width, one H-FILL/V-HUG plain Text per V/FILL cell, bounded
cell padding, and an excluded CENTER bottom1 rule with zero row padding. Text
logical height plus real cell top/bottom padding resolves intrinsic height.
Captured fractional cell insets and owner outer bottom padding are preserved;
the solver does not invent a CSS half-edge allocation. The existing included
INSIDE bottom1 model remains separate. CENTER included, outside/other rules,
unproven children, width cycles and other unsupported dependencies keep their
diagnostics. No canonical field or generic HTML table promotion is added.

For the two bottom-rule cases, source cell padding is first top10/bottom10.5
and later top10.5/bottom10.5; the owner bottom is0.5. Initial row heights are
45.5/71/96, owner213. The final-rule-absent control uses last bottom10 and owner
bottom0, giving45.5/71/95.5 and212. All Text uses Inter19 and physical25px line
height. First-value source copy1→4→1 lines and owner630→390→630 reflowed without
manual row/cell height repair. The five native stages and exact source boxes are
in `native-stages.json`. Initial/copy-restored/width-restored official JSON and
complete PNG bytes are identical in the archived run.

`native-rule-bands.json` retains actual full-width rule scanline counts and
per-column RGBA at the independent source-rule positions. The transparent and
last-rule-absent cases have 14,550 exact #cecece pixels across all stages. Opaque
cells remain a CSS collapsed-rule paint negative: 8,730 expected gray pixels
differ and none is exact gray. This geometry support is not a promise that
parent strokes paint over opaque children. No paint order is changed.

CPU browser tests use one exact local Inter font in independent CSS controls
and SVG, check both transparent cases with strict pixel equality, and check
actual native rule-band RGBA. They retain the opaque CSS paint negative and the
existing explicit frontend-export refusal for non-inside independent sides.
They do not establish full local-font/native-Figma glyph PNG parity. CPU Node
checks compare every captured row/cell/Text box, save/reopen and no-op binding;
production VM checks active-only exclusion setter order and existing-Grid
stroke patch projection. No actual native action runs in this test suite.
