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
  "resources": [],
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

## One file for transfer or archival

The editable source format is `codeshell.design` version 3. A small `.codesign.json` contains
its complete page/layer tree, but images/fonts and companion review/source/prototype data may
refer to project-owned files. A large saved source may itself be a checked page index. Copying
only that source is therefore not a complete portable design.

Use **完整备份 → 下载完整备份** to create one `design-complete-backup.json`. Its envelope is
`codeshell.design.portable-backup` version 2, containing the materialized v3 `document`, verified
image/font `resources` as Base64, and validated `attachments` for comments, Figma source binding
and prototype interactions. It can be restored into an independent design path without the old
project. The current portable-file limit is 128 MiB. This container is JSON, not a `.fig` file.

The `html2figma` repository uses a separate `DesignNode` intermediate tree and custom Figma-node
JSON. Its `.dsl` download is an encrypted transport container for that custom Figma JSON, not this
v3 document and not the official Figma REST schema. Interoperability needs an explicit adapter;
renaming extensions does not convert coordinates, node types, layout or resource references.

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

- primitives: `rectangle`, `ellipse`, `text`, `image`;
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

## Images and fonts

Large binary payloads never live inside the document or page objects. Top-level `resources`
contains stable descriptors with an id, kind, MIME type, binary byte length, SHA-256, and part
count. Font descriptors also carry family, weight, and style. Image nodes reference an image
descriptor with `imageRef` and choose `fill`, `contain`, or `cover` through `objectFit`; text nodes
may reference a font descriptor with `fontRef`.

The bytes are Base64-encoded into independently bounded, content-addressed objects below
`designs/codesign-data/images/` or `designs/codesign-data/fonts/`. Two resource ids with identical
bytes reuse the same physical objects. Design Studio loads only resources referenced by currently
materialized pages, verifies their byte count and SHA-256 before use, and embeds referenced images
in SVG previews. Use the `put_design_resource` Agent tool or the editor save path; do not edit
resource objects directly. Small Agent uploads may use inline Base64. Larger ones use ordered
Base64 `.txt` source chunks below `designs/`, keeping each tool invocation below its argument
budget; only the verified content-addressed result becomes part of the design library.

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

Signed gaps down to −2000 are supported only on the main axis of horizontal/vertical nowrap
stacks with fixed or Fill main sizing. Cross-axis and Grid gaps remain nonnegative. Negative
spacing with wrapping, reverse order, or main-axis Hug is rejected; unsupported native imports
retain measured geometry with a diagnostic. Editable CSS export uses main-end child margins
for signed spacing and excludes hidden/absolute children from inter-item spacing.

Containers store `layout`, uniform `gap`/`padding`, `alignItems`, and `justifyContent`. Layout is
`none`, `horizontal`, `vertical`, or `grid`. Optional `rowGap` and `columnGap` override the
axis-specific gap; four side padding values similarly override uniform padding.
Horizontal and vertical layouts support `layoutWrap: "wrap"` or `"wrap-reverse"` plus
`alignContent` for the line block. `layoutReverse: true` reverses the main-axis order without
rewriting sibling source order. `alignItems: "baseline"` aligns mixed-size text rows. Grid uses
equal-width `gridColumns` from 1–24, row-major placement, and optional
`gridColumnSpan`/`gridRowSpan` on each child.

Every node may independently set `layoutSizingHorizontal` and `layoutSizingVertical` to `fixed`,
`hug`, or `fill`. Fixed preserves the materialized size, Hug sizes an Auto Layout container to its
visible flow content, and Fill consumes available parent space on that axis. A Fill child under a
Hug parent on the same axis uses its current intrinsic size so the circular request stays
deterministic. Optional `layoutAlignSelf` overrides the parent's cross-axis alignment for one flow
child. Optional `minWidth`, `maxWidth`, `minHeight`, and `maxHeight` bound Fixed, Hug, Fill,
stretch, scale, and responsive text sizing without discarding the selected sizing mode.
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
levels, 10,000 expanded render layers per page, 32 color tokens, 2,048 resource descriptors, and
64 MiB per resource. There is no whole-document byte limit. Canonical sources within the
CodeShell Host's per-file write budget remain one
ordinary `.codesign.json`. Larger sources use a canonical `codeshell.design.index` at that path;
each page is an independently checksummed, content-addressed object below
`designs/codesign-data/pages/`. Saving writes only changed page objects and commits the index last.
Opening an index loads the active page and its transitive component dependencies, then keeps clean
pages in a bounded cache; page reads, switching, and global operations materialize more pages only
when required. Undo/redo records structural operations, and crash recovery persists the operation
delta from the last saved state. Large recovery logs use verified content-addressed chunks rather
than app-storage copies of the whole document.
The older `codeshell.design.bundle` format remains readable and migrates on the next save. Use
`codeshell-design-v3.schema.json` for repository validation. SVG and `*.audit.md` are generated
review artifacts, never authoritative sources.

Native Grid interchange can additionally preserve `gridRows` (1–24),
`gridColumnSizes`/`gridRowSizes` (one `{type: "fixed", value: px}`,
`{type: "flex", value: fr}` or `{type: "hug"}` per declared column/row),
`gridItemsPositioning` (`manual` or `row-auto-flow`) and `gridAutoTracks`
(`none` or `rows`). FLEX tracks require a non-HUG container axis. Manual children
use zero-based `gridRowAnchorIndex`/`gridColumnAnchorIndex`; spans retain the existing
1–24 bounds. `gridChildHorizontalAlign`/`gridChildVerticalAlign` accept `auto`,
`start`, `center`, `end`; size still follows the existing axis sizing fields.
Legacy equal-column grids remain valid and use their existing dense placement.
The Figma plugin creates native GRID, uses live track setters and requires the
current Grid plugin API. Unsupported grids fail with an actionable message; they
are never silently rasterized. Changes to these advanced fields in a source-bound
patch are diagnosed as unsupported; use a new-page conversion to apply them.

Axis-FILL children touching a HUG track currently require a fixed track or a HUG/fixed child to avoid an unmodeled intrinsic-size cycle. This is diagnosed explicitly before claiming native Grid fidelity. Automatic rows derive the current occupied row count (within 24), extending new canonical rows as HUG and trimming trailing empty rows. Interior empty manual rows with automatic-row mode are diagnosed because Figma removes empty rows.

Circular corner radii use the required uniform `cornerRadius` number by default.
Rectangles, Frames, Components and images may additionally store `cornerRadii` as
exactly four finite pixel values from 0 to 9999, clockwise from top-left
(TL, TR, BR, BL). This optional tuple overrides the uniform radius, preserves
authored values on resize, and uses CSS's common overlap scale when rendering.
Editing the uniform radius clears the tuple. Text, groups, instances and ellipses
do not accept a per-corner tuple. Percentage/elliptical CSS corners and native
Figma corner smoothing produce explicit diagnostics. Figma export uses the
[individual native radius properties](https://developers.figma.com/docs/plugins/api/FrameNode/);
oversized asymmetric radii receive an export warning until native overlap
behavior is verified against CSS.

Native Figma TEXT imports convert the native line-box top to the v3 hanging
origin using the loaded browser font and line height. `layoutBaselineOffset`
retains the logical line-box origin, and optional text-only `layoutBaselineSource: "native"`
records that convention independently of glyph receipts for later typography edits,
including absolute/root text and Node-only reflow followed by browser editing. Native
creation and source patches project the hanging origin back to the line box;
a baseline-only change does not become a native translation. Own-rotated text
and offsets exceeding the existing coordinate/baseline-field budgets are diagnosed
without guessing an origin. Explicit newlines in native single-line ellipsis retain
the full source, preview only the first line, and produce a truncation diagnostic.
