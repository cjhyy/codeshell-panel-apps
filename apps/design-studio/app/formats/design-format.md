# Design Studio Panel App document format v1

The durable source file ends in `.codesign.json`.

```json
{
  "format": "codeshell.design",
  "version": 1,
  "name": "Product home",
  "canvas": {
    "width": 1440,
    "height": 960,
    "background": "#f5f5f2"
  },
  "tokens": {
    "colors": [{ "name": "Ink", "value": "#171717" }]
  },
  "nodes": []
}
```

Every node has:

- `id`: unique stable string without control characters;
- `type`: `frame`, `rectangle`, `ellipse`, or `text`;
- `name`: human-readable layer name;
- `x`, `y`, `width`, `height`: finite numbers in document coordinates;
- `fill`, `stroke`: CSS hex colors or `transparent`;
- `strokeWidth`, `opacity`, `rotation`, `cornerRadius`: finite visual properties;
- `visible`, `locked`: booleans.

Color variables remain a compact named palette while node colors stay explicit, so the JSON and SVG
render without a token resolver. When a variable value is edited in the panel, matching canvas,
fill, and stroke values are propagated in the same document edit.

Non-frame nodes may also use `parentId` to name a frame. Parent ids must resolve to a frame in the
same document. Frame children keep absolute document coordinates, but the panel treats them as a
unit when the frame is moved, nudged, aligned, distributed, copied, reordered, or deleted. Frames
themselves remain root nodes in v1. A frame may set `clipContent: true`; the canvas and generated
SVG then clip its children to the frame's rounded, rotated bounds. A Frame's `rotation` is also
inherited visually by its children in both the panel and SVG export; the children's stored
coordinates remain absolute, unrotated document coordinates so diffs stay straightforward. A
Frame's visibility and opacity also cascade visually to its children; child opacity is multiplied
by Frame opacity in the canvas and generated SVG.

When changing `parentId` in code, preserve visual geometry: convert the layer center between the
old and new Frame coordinate spaces, and adjust the stored layer rotation by the difference between
the two Frame rotations. The panel performs this conversion automatically during inspector-based
reparenting.

Any node may carry an optional `notes` string for interaction, responsive, accessibility, or
implementation guidance. Notes are repository metadata and do not render into the canvas or SVG.

The document may contain at most 500 nodes and 32 color variables. Its complete pretty-printed
JSON must not exceed 192 KiB. This keeps explicit saves and scoped unsaved recovery within the
panel host quotas; split unusually large work into multiple design files. The panel blocks create,
duplicate, paste, and frame operations before they would cross the node limit.

Text nodes additionally use `text`, `fontSize`, `fontWeight`, `lineHeight`, and `textAlign`; their
text color comes from `fill`. The current panel renders explicit newlines and uses the platform
sans-serif font stack.

The node array is back-to-front paint order: the first node is the bottom layer and the last node is
the top layer. Every frame must be immediately followed by all of its children, with the frame
first so its fill paints behind them. The strict loader rejects interleaved frame trees, while the
panel preserves this grouping during create, duplicate, paste, reparent, reorder, and release
operations. Keep JSON object keys in the order emitted by the panel to minimize noisy diffs.

For automated validation, use the colocated
`references/codeshell-design-v1.schema.json` JSON Schema. The panel rejects unknown or missing
fields, out-of-range or mistyped values, duplicate node ids, orphaned frame references, misplaced
type-specific fields, empty or duplicate color-variable names, invalid node records, and
over-limit collections instead of silently defaulting or discarding repository data. It only
canonicalizes hexadecimal color casing and JSON formatting.

Generated SVG previews include `data-node-id` on each rendered element. This is review metadata
only; the JSON document remains authoritative.

Optional sibling `*.audit.md` files are deterministic derived reports from the panel's boundary,
hierarchy, empty/undersized-text, and shape/opacity-aware contrast checks. They may be committed for
review but are not design sources.
