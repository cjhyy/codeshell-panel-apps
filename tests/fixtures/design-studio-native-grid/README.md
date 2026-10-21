# Native Grid regression sources

`source.mjs` builds the small synthetic native Grid acceptance fixture.

`figma-hidden-row-flow.json` is the GRID subtree exported by the real Figma
plugin API from that synthetic fixture during acceptance run
`real-figma-html-v3-1792517416323-ec153941` (`07-official-source-after.json`).
Only the fixture's Grid subtree is retained; account/file context and other
page contents are omitted.

The first span-two rectangle is hidden. Figma reports its row/column anchors as
`-1`, retains the rectangle and its span, and positions the three visible
children in one row. The container uses `ROW_AUTO_FLOW` and `ROWS`, with one
`FIXED 40` row. These observed API values guard the import and native copy paths
against silently flattening a real Grid or counting an invisible layer as a
flow cell.
