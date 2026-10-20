# Native padded one-row Grid fixture

The immutable native run `fc6bb994` created three width owners, each retaining
three independent row Grids and nine real padded cells with Text descendants.
The source fixture retains all 67 non-page IDs, boxes, characters and style.
Only the production `preserveNativeGrid` supplement adds archived live Grid and
stroke inclusion getters to the same official export. SHA receipts are in
`provenance.json`; `native-initial.json` holds the independent raw initial boxes.

The supported dependency is bounded: one HUG row, fixed/flex columns, a single
plain wrapped H-FILL/V-HUG Text inside each V cell, and bounded cell padding.
A row may have H-FILL only under a direct V parent with fixed, unconstrained
width. An optional included INSIDE bottom1px rule is counted once in canonical
effective padding. Positive excluded Grid rules, other alignments, multiple HUG
rows, unsupported typography and width cycles retain diagnostics/fallback.
No new document field or native inclusion provenance is introduced.

Native cell Text height plus cell vertical padding gives row content height.
The included bottom rule adds1px. Copy2→4→2 and owner630→390→630 were observed
without manual row/cell height repair. Native initial/restored PNG and official
JSON were byte-identical; the broader raw run and analysis remain in the task
journal evidence outside Git.

CPU browser tests load the repository's exact Inter font for independent CSS,
SVG and frontend comparisons, including direct exported width/copy edits. They
prove those renderers agree with each other, not that local Inter font bytes
match the native Figma font. The probe rule #b1b4b6 differs from the frozen GOV
source #cecece, and native included INSIDE1 is not a CSS collapsed half-edge
allocation model. This change does not promote HTML TABLE/DL or claim whole GOV
page parity.
