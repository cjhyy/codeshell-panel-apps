# CodeShell Design v3 repository format

The authoritative source ends in `.codesign.json`. Design Studio now reads and writes v3 only; the
first release intentionally carries no v1/v2 migration path because existing design content is not
being preserved.

```json
{
  "format": "codeshell.design",
  "version": 3,
  "name": "Product UI",
  "canvas": {
    "width": 1440,
    "height": 960,
    "background": "#f5f5f2"
  },
  "tokens": {
    "colors": [{ "name": "Ink", "value": "#171717" }]
  },
  "activePageId": "page-1",
  "pages": [
    {
      "id": "page-1",
      "name": "Page 1",
      "children": []
    }
  ]
}
```

Color tokens are named document-level literals rather than per-node reference objects. Editing a
token in Design Studio—or replacing the complete token set through `set_document` while preserving
that token name—simultaneously propagates its old value through matching canvas, fill, stroke, and
shadow colors. If two retained tokens share one old literal, they must resolve to the same new
literal because a painted node cannot distinguish which name supplied that value.

## Repository binding and live sync

Each project gets its own active file and recovery snapshot. The panel restores recovery, reopens
the last file, otherwise prefers `designs/design.codesign.json`, then opens the newest remaining
file below `designs/`, and finally starts a blank document at that default path. A clean canvas
reloads repo edits automatically. A dirty canvas shows a conflict instead of overwriting either
side.

Design Studio's bundled Agent tools operate on the same in-memory document, refresh the canvas
immediately, and save to the active repo source by default. This avoids the delay and ambiguity of
asking an Agent to perform blind text replacement.

The header page switcher changes the active canvas and can create pages directly. Agent page
operations can create, rename, activate, and delete pages; page operations use a separate
transaction from node edits so each layout transaction has one unambiguous active page.

## Recursive layers

Pages contain recursive `children`. Frames, groups, and components are containers and may contain
any supported node, including another container. Repository JSON does not use `parentId`; that is a
temporary flat-editor representation.

All nodes have stable ids, names, geometry, fill/stroke, opacity, rotation, visibility, and lock
state. Optional `notes` carry implementation, interaction, responsive, and accessibility intent.
`x` and `y` are always absolute document coordinates, including for nested nodes. Parent/child
relationships control hierarchy, transforms, visibility, opacity, and clipping; they do not create
a relative coordinate origin.

Supported node types:

- primitives: `rectangle`, `ellipse`, `text`;
- containers: `frame`, `group`, `component`;
- reusable references: `instance`, linked with `componentId`.

Text nodes require content, size, weight, line height, and alignment. Optional `fontFamily`,
`fontStyle`, `letterSpacing`, and `textDecoration` provide repository-stable typography controls;
when omitted they render with the editor's system sans-serif defaults.
HTML imports may add `textMeasurement: "browser"` after measuring the exact rendered Range bounds.
The audit then trusts the stored width instead of substituting its portable cross-font estimate.
Adaptive imported text may also preserve `textSource`, the last measured `textFlowWidth`, and
`layoutBaselineOffset`. `textFlow: "wrap"` regenerates explicit line breaks when an Auto Layout
parent changes width. `textOverflow: "ellipsis"` regenerates a single truncated line ending in
`…`. These fields keep the source copy editable while the materialized `text` remains the rendered
fallback.
Newline-delimited text renders as explicit, independently positioned SVG lines so native preview
renderers preserve the live canvas layout. Text fill and optional stroke render consistently in the
live canvas and SVG preview.
Text does not paint a containing box, so its required `cornerRadius` remains `0`.

Any painted node except a transparent organizational group may carry one optional `shadow` with
hex `color`, 0–1 `opacity`, X/Y offset, and blur radius. Shadows are source data and render
consistently in the live canvas, Agent screenshots, and SVG exports. The audit treats a visible
shadow crossing the canvas or an ancestor clipping boundary as a blocking render defect even when
the node's own geometry still fits.
HTML capture may add `effectClipping: "intentional"` for deliberately clipped shadows and
`contentClipping: "intentional"` when the browser itself clips child overflow. These markers
suppress only their corresponding false-positive clipping issues.
Visible stroke width is audited the same way, because half of an SVG stroke extends outside the
node geometry.
Shadow filter regions are derived from the rendered node, stroke, and instance-content bounds, so a
small layer with a large blur is not silently cropped by the SVG filter itself.

Groups and instances do not paint their own fill, stroke, or corner radius. Their required
repository appearance fields stay `transparent`, `transparent`, `0`, and `0`; group appearance
comes from its children, and instance appearance comes from its component master. Both still
support whole-layer opacity and rotation, while instances may also carry a shadow around their
rendered component content.

## Auto layout and components

Containers store `layout`, uniform `gap`/`padding`, `alignItems`, and `justifyContent`. Layout is
`none`, `horizontal`, `vertical`, or `grid`. Optional `rowGap` and `columnGap` override the
axis-specific gap; four side padding values similarly override uniform padding.
Horizontal and vertical layouts support `layoutWrap: "wrap"` plus `alignContent` for the line
block. Grid uses equal-width `gridColumns` from 1–24, row-major placement, and optional
`gridColumnSpan`/`gridRowSpan` on each child.

Every node may independently set `layoutSizingHorizontal` and `layoutSizingVertical` to `fixed`,
`hug`, or `fill`. Fixed preserves the materialized size, Hug sizes an Auto Layout container to its
visible flow content, and Fill consumes available parent space on that axis. A Fill child under a
Hug parent on the same axis uses its current intrinsic size so the circular request stays
deterministic. Optional `layoutAlignSelf` overrides the parent's cross-axis alignment for one flow
child.
Optional `layoutMarginBefore: "auto"` consumes surplus main-axis space before that child, matching
`margin-left: auto` in a horizontal container or `margin-top: auto` in a vertical container.

An Auto Layout child with `layoutPositioning: "absolute"` is excluded from flow and preserves its
absolute-canvas `x/y`. It may set `constraintHorizontal` and `constraintVertical` to `start`,
`center`, `end`, `stretch`, or `scale`, with four optional inset values. Stretch preserves both
edge insets; end preserves the trailing inset; center follows the parent center. Scale uses
`constraintBaseWidth`/`constraintBaseHeight` as stable import-time dimensions so repeated reflows
do not compound growth. Other visible direct children participate in flow; hidden and absolute
children consume no layout space. Nested layout resolves Hug bottom-up and Fill/positions
top-down until geometry converges. Moving a container still moves its complete subtree, including
absolute descendants.

Current absolute-canvas geometry is always materialized so Git diffs, screenshots, and Agent reads
remain understandable. A flow child's stored `x/y` is resolved/fallback geometry owned by its
parent; an absolute child's `x/y` remains semantic. Manual containers preserve all child geometry.
Auto Layout reflows only after relevant structure, visibility, size, or layout inputs change. A
configured gap is a minimum under `space-between`; tight containers report overflow rather than
compressing it. Direct dragging, nudging, alignment, and distribution are blocked only for
flow-owned positions.

A component is a visible master subtree. Instances store `componentId` and their own bounds.
Editing a master updates every instance. Complete nested descendants render in instances, and a
component may compose instances of other components. Masters may live on a component-library page
while instances render on another page. Self-references and component dependency cycles are
rejected. Instances render only their master's own subtree: visibility, opacity, rotation, and
clipping from organizational ancestors outside the master do not leak into an instance. Deleting a
master removes its instances across all pages. Deleting a page that owns masters is rejected while
another page still contains instances linked to those masters.
Component composition is limited to 16 instance levels and 10,000 expanded render layers per page.
These limits apply after instance expansion, so a small but exponentially reused acyclic component
graph is rejected before it can exhaust the live canvas, screenshot renderer, or SVG exporter.

## Determinism

JSON is pretty-printed with stable property order and a trailing newline. Colors are lowercase.
Unknown fields, dangling component references, duplicate ids, invalid page references, and trees
deeper than 32 levels are rejected.

Layout and accessibility audit runs across every page. Issue records carry the stable page id and
page name so an inactive page cannot hide clipping, overflow, effect clipping, text sizing, or
multi-point text-contrast defects.

Operational safety limits are 1,000 pages, 10,000 source nodes per page, 16 nested instance
levels, 10,000 expanded render layers per page, and 32 color tokens. There is no whole-document
byte limit. Canonical sources within the CodeShell Host's per-file write budget remain one
ordinary `.codesign.json`. Larger sources use a canonical `codeshell.design.index` at that path;
each page is an independently checksummed, content-addressed object below
`designs/codesign-data/pages/`. Saving writes only changed page objects and commits the index last.
The older `codeshell.design.bundle` format remains readable and migrates on the next save. Use
`codeshell-design-v3.schema.json` for repository validation. SVG and `*.audit.md` are generated
review artifacts, never authoritative sources.
