---
name: repo-design
description: Create, import from rendered HTML, inspect, refine, and visually verify the active repository's CodeShell Design v3 source through Design Studio's structured Agent tools. Use for repository design files, HTML-to-design reconstruction, Figma-like layout work, and screenshot-driven fidelity checks.
---

# Repository design workflow

Use the installed Design Studio Panel App as the authoritative structured editor for
`designs/*.codesign.json`.

1. Call the built-in `Panel` tool with `action: "tools"` and
   `panel_id: "panel-app:design-studio"` when you need the live tool schemas.
2. Call `get_design_metadata` before editing. Reuse stable node ids and inspect the smallest
   relevant subtree with `get_design_context`. For a large top-level screen, begin with
   `max_depth: 1` or `2`, then deepen only the branch you will change. If
   `descendantsTruncated` is true, the returned empty child list is a context boundary—not proof
   that the source node has no children. Metadata lists every page, its node count, and a compact
   page catalog plus the active page's layer index, whose entries carry `pageId` and `pageName`.
   Use `get_design_context.page_id` to read one indexed page without loading the complete logical
   document into an Agent result; a subtree read may target a stable node id and returns its page
   identity.
   Before creating new visual primitives, call `search_design_system` with the intended semantic
   role, then use the layer index and `get_design_context` to inspect likely component matches.
   Metadata's `tokens` is the complete color-token inventory. Read the full document only for a
   whole-document structural decision and only when `documentBytes` leaves ample room below the
   Agent result budget; oversized reads fail with instructions to use a bounded subtree. Reuse an
   existing component or color token when it
   expresses the intended role; do not create a visually duplicate local substitute.
   A large logical design is stored as a `codeshell.design.index` plus immutable,
   content-addressed page objects under `designs/codesign-data/pages/`. Treat those files as one
   document and never edit the objects directly. Design Studio verifies pages independently and
   reuses unchanged pages on save; Agent work remains metadata → bounded subtree → transaction
   regardless of the repository storage mode. `codeshell.design.bundle` is a read-only legacy
   migration format.
3. Call `use_design` with a short transaction of operations. It refreshes the live canvas and
   saves the active repo source by default. Its compact `audit` summary is an immediate regression
   signal, but call `validate_design` to read the actual issue records. `changedNodeIds` includes
   nodes moved indirectly by auto layout, and `documentChanged` identifies canvas/token/name edits.
   The tool requires metadata's `stateRevision` as `expected_state_revision` on every edit so a
   human change, undo/redo, page switch, workspace switch, or unsaved Agent transaction cannot be
   overwritten from a stale read.
   When metadata returns a non-null repository `revision`, also pass it as `expected_revision`.
   Either mismatch fails before any design mutation and requires a fresh read.
   Before creating a UI region, choose its layout owner: use nested horizontal/vertical containers,
   Wrap, or Grid for normal rows, columns, navigation, messages, controls, and repeated content.
   Use `layoutPositioning: "absolute"` for an overlay inside Auto Layout; use a manual container
   only for deliberately art-directed overlap or unsupported visual primitives. Do not begin a
   normal application screen as one large `layout: "none"` tree.
4. Call `validate_design` after every meaningful edit. It audits every page, not only the active
   canvas. `valid` is true only when no audit issues remain. `renderSafe` isolates blocking
   clipping, canvas overflow, and text-layout failures, but non-blocking contrast/content warnings
   still require deliberate resolution before finishing. Rounded clipping follows rendered shapes
   instead of rectangular bounds, and component text is rechecked in every instance after target
   background, scaling, and whole-instance opacity are applied.
5. Call `get_design_screenshot` and inspect the actual image. Use `node_id` to crop and enlarge the
   region you changed; its page is resolved automatically. Use `page_id` without `node_id` for a
   complete image of any page without changing the active page. Repeat edit → validate → screenshot
   until hierarchy, spacing, clipping, contrast, and visual polish are correct. Never claim that
   warnings do not affect rendering without checking their codes and the screenshot. A node-region
   screenshot includes visible descendants outside a non-clipping container and their effects,
   excludes geometry hidden by any clipping ancestor, and does not let organizational group bounds
   create blank margins. Instance crops also reserve space for visible, non-clipped geometry and
   shadows in the referenced master subtree. Hidden nodes fail explicitly instead of producing a
   blank image. Read tools wait for queued saves and never rewrite the live document. If the source
   changes while an image is rendering, screenshot generation fails instead of labeling an older
   image with a newer `stateRevision`.

Keep transactions small enough to diagnose. A useful iteration normally changes one coherent
region (for example the top bar or one message card), validates it, and then looks at the complete
screen. Do not replace a detailed screen with empty frames merely to make warnings disappear.

## HTML fidelity workflow

When HTML is the visual source, do not reconstruct it from markup or hand-copy relative offsets.
Read metadata, then call `import_html` with the workspace-relative `.html` path, exact viewport,
optional root selector, current `expected_state_revision`, and current `expected_revision` when
non-null. The default root is `html`. The importer converts only the root's visible intersection
with the first viewport: fully offscreen descendants are omitted, while partially visible content
keeps its measured geometry behind an intentional root clip. Use a tighter selector when the
desired design is one visible region. The tool reads up to 20 relative local CSS files, removes
scripts and network resources,
waits for fonts and two animation frames, then replaces the canvas with computed geometry,
typography, paint, borders, clipping, and one non-inset shadow. Supported CSS Flex and Grid
containers become v3 Auto Layout with independent row/column gaps, Wrap, column/span
metadata, four-side padding, alignment, and dual-axis Fill/Fixed semantics. Absolute/fixed direct
children become `layoutPositioning: "absolute"`, leave the flow, and carry start/end/stretch
Constraints with four measured insets. Browser-measured `x/y` remain in the saved file as exact
initial geometry and fallback data; Auto Layout owns only flow-child positions after a reflow.
Form values, browser text baselines, and wrappable text source are preserved. Reverse directions,
unequal Flex grow factors, floats, unequal Grid tracks, and decoration-heavy controls fall back to
measured manual geometry instead of silently changing the screenshot. It saves by default, returns
canonical `documentBytes`, the `indexed-pages` capacity model, an immediate audit and rollback
`transactionId`, and fails if the live design changes while HTML is rendering.
Add stable `data-codeshell-id` and `data-codeshell-name` attributes to important source elements
when later Agent edits need durable layer identities.

Compare the rendered HTML and exported Design SVG in the same browser, viewport, device scale, and
font environment. Save the source, converted, and amplified pixel-difference screenshots. Report
the measured error rather than claiming a subjective match; use mean absolute channel error,
changed-pixel percentages at explicit thresholds, and a local/windowed SSIM. Iterate on the largest
cluster in the difference image before polishing isolated pixels.

In the `codeshell-panel-apps` collection repository, run the maintained baseline with:

```sh
npm run test:fidelity -- --output artifacts/design-studio-html-fidelity
```

Run the adapted html2figma catalog before changing capture or layout behavior:

```sh
npm run test:fidelity:cases -- --output artifacts/design-studio-html2figma-cases
```

It covers 19 representative cases selected from the 64-case upstream catalog: Hug/Fill/Fixed,
Wrap, Grid spans, Constraints, navigation, cards, forms, tables, inline text, lists, SVG,
borders/shadows, nesting, dashboards, and baseline alignment. It renders both the original HTML
and converted design at the import width and a narrower width, then writes per-case source,
converted, diff, side-by-side, design JSON, metrics, audit codes, and a summary report.

For public-page diagnostics, run `npm run test:fidelity:real -- --output
artifacts/design-studio-real-html-fidelity`; it is not a CI gate because pages are external.

Treat it as a regression gate: the measured conversion needs windowed SSIM of at least 0.99, at
most 1% of pixels changing by more than 8 channel levels, and at most 0.6% changing by more than 24
levels. The fixture must also preserve at least 20 Auto Layout containers. After resolving every
Auto Layout once, the semantic reflow comparison must keep windowed SSIM at or above 0.86, the two
changed pixel ratios at or below 8% and 6%, and zero blocking audit issues. The JSON report, captured and
reflowed design sources, and measured/reflow screenshot artifacts are evidence for both initial
fidelity and adaptive stability. The varied html2figma suite uses broader gates because it includes
CSS shapes that v3 intentionally approximates: initial SSIM ≥ 0.94 and >24-level changed pixels
≤ 8%; narrow-width SSIM ≥ 0.87 and changed pixels ≤ 12%; both require zero blocking issues.
Imported browser-measured text and deliberately clipped effects carry explicit document metadata
so validation does not turn exact browser geometry into false layout blockers.

Treat unsupported CSS as an explicit fidelity gap. v3 currently approximates four unequal corner
radii with one representative radius. Basic inline SVG rectangles, circles, ellipses, and text
paint are measured; raster images, SVG paths/references, gradients, pseudo-elements, multiple
backgrounds, multiple shadows, filters, and rich text runs are not.
Extend the format/capture path or disclose the limitation; never silently call those cases
pixel-perfect. After conversion, normalize the document, keep it below repository size limits,
call `validate_design`, and inspect a Design Studio screenshot before editing it further. Use the
bundled `app/html-capture.mjs` helper directly only when developing the importer or running its
browser regression fixture.

## Resolved geometry and coordinate fallback

The editor materializes every node's resolved `x` and `y` as **absolute document/canvas
coordinates**, including nodes nested inside frames, groups, and components. They are never
parent-relative. This does not make `x/y` the semantic layout source for every node: a
horizontal, vertical, or Grid parent owns the resolved positions of its direct flow children. Omit
child `x/y` when creating those children through Agent operations; read the coordinates back after
reflow only for inspection, screenshot cropping, and fallback geometry. A child with
`layoutPositioning: "absolute"` is excluded from that flow and must use absolute-canvas `x/y`.

Every root-level or manually positioned node must provide both `x` and `y`; never rely on the editor
default because multiple omitted positions would overlap at the canvas origin.

For example, if a frame starts at `(80, 40)` and has 24 px visual inset, its first manually
positioned child starts near `(104, 64)`, not `(24, 24)` and never `(0, 0)`. Before writing a nested
node, read the parent bounds and verify:

- `child.x >= parent.x`
- `child.y >= parent.y`
- `child.x + child.width <= parent.x + parent.width`
- `child.y + child.height <= parent.y + parent.height`

Rotated layers are the exception: use `validate_design` and the screenshot rather than relying only
on axis-aligned arithmetic. Rounded clipping containers need the same visual check: fitting inside
their rectangular bounds is necessary but not sufficient near a corner arc, so inset important
content or verify the exact rendered clip with validation and a node screenshot.

When placing a child manually, calculate `left=x`, `top=y`, `right=x+width`, and
`bottom=y+height`.

If `clipContent` is true, an out-of-parent child edge blocks validation unless imported browser
geometry carries `contentClipping: "intentional"`. Never add that marker to hand-authored layouts.

## Manual layout versus auto layout

Containers technically default to `layout: "none"`, `gap: 0`, and `padding: 0`, but normal UI
structure should not inherit that default accidentally. In manual layout, Agent-supplied absolute
geometry is preserved across transactions.

When a container uses `layout: "horizontal"`, `"vertical"`, or `"grid"`, it owns its direct flow
children’s positions. Configure `padding`, optional `rowGap`/`columnGap`, `alignItems`,
`justifyContent`, and `alignContent`. Horizontal/vertical containers may set
`layoutWrap: "wrap"`; Grid uses `gridColumns` and child `gridColumnSpan`/`gridRowSpan`.
Set each child's `layoutSizingHorizontal` and `layoutSizingVertical` independently to `fixed`,
`hug`, or `fill`. Hug resizes an Auto Layout container to visible flow content; Fill consumes its
available parent axis. A Fill child under a Hug parent on the same axis uses its current intrinsic
size to break the circular dependency.
Use `layoutAlignSelf` only when one flow child must override the parent's cross-axis alignment.
Structural, visibility, sizing, or layout-property changes reflow only affected containers.
When an outer layout moves a nested container, Design Studio moves its complete subtree and then
resolves nested sizing and layout to convergence.

Set `layoutPositioning: "absolute"` only for overlays, badges, and decoration that must stay inside
an Auto Layout container without consuming space. Provide absolute-canvas `x/y`; the canvas allows
dragging and nudging those nodes. Flow children block direct position edits; change sibling order
or parent layout instead. Add horizontal and vertical Constraints (`start`, `center`, `end`,
`stretch`, or `scale`) plus the corresponding measured insets. Preserve
`constraintBaseWidth`/`constraintBaseHeight` for stable scale behavior after repeated reflows.
Hidden direct children do not consume auto-layout space, so changing `visible` reflows their parent.
Use optional `paddingTop`, `paddingRight`, `paddingBottom`, and `paddingLeft` overrides when a
container needs asymmetric inset; an omitted side falls back to the container’s uniform `padding`.
With `justifyContent: "space-between"`, configured `gap` remains the minimum gap; surplus room is
distributed, but a tight container never silently compresses that explicit spacing value.
Use `layoutMarginBefore: "auto"` on a flow child for CSS-like `margin-left: auto` in a horizontal
container or `margin-top: auto` in a vertical container.

Use Auto Layout by default for application shells, panels, repeated rows, button contents,
navigation items, chips, cards, forms, messages, and content whose order or size can change. Use
an absolute child for a local overlay and manual layout for canvas artwork or unsupported
semantics.

## Typography

Text nodes support the required `text`, `fontSize`, `fontWeight`, `lineHeight`, and `textAlign`
fields plus optional `fontFamily`, `fontStyle`, `letterSpacing`, and `textDecoration`. Use
`fontWeight` values from 100 through 900 in 100-step increments. Prefer a practical fallback stack
such as `Inter, ui-sans-serif, system-ui, sans-serif`; a named font may not be installed on every
review machine. Validate text-box height after changing type metrics and inspect the screenshot for
unexpected fallback, density, or clipping. Text fill and stroke render, but text has no containing
box, so keep `cornerRadius` at `0`.

## Effects

Painted nodes support one repository-stable drop shadow:

```json
{
  "shadow": {
    "color": "#000000",
    "opacity": 0.18,
    "x": 0,
    "y": 12,
    "blur": 32
  }
}
```

Use a subtle shadow to clarify elevation, not as a substitute for hierarchy or spacing. `opacity`
is 0–1, X/Y are -500–500, and blur is 0–200. Set `shadow: null` in an Agent update to remove it.
Groups have no painted box and therefore do not accept a shadow; apply it to a visible child,
frame, component, or instance. Inspect the screenshot because effects can feel too heavy even when
their numeric bounds are valid.

Groups and instances also keep `fill` and `stroke` as `"transparent"` and `strokeWidth` and
`cornerRadius` as `0`, because those layers do not paint their own box. Edit group children or the
instance's component master instead. Whole-layer opacity and rotation remain valid for both.

## Transaction patterns

For a manually positioned region:

1. Read the parent subtree and note its absolute bounds.
2. Create or update children with complete absolute geometry.
3. Validate immediately.
4. If any edge is wrong, correct the geometry before adding more descendants.

For an auto-layout region:

1. Set layout direction/Grid columns, Wrap, padding, axis gaps, alignment, and distribution.
2. Create or move children into sibling order without supplying child `x/y`.
3. Set child width/height and horizontal/vertical `fixed`, `hug`, or `fill` sizing.
4. For an overlay, set `layoutPositioning: "absolute"` and provide absolute-canvas `x/y`.
5. Read the subtree again after the transaction because the resolved geometry is explicit.

`use_design` and `import_html` are atomic. If an operation, conversion, or save is invalid, the
canvas rolls back. Prefer one
transaction when several operations must stay consistent, such as creating a frame and its first
children; use separate transactions when visual inspection should decide the next edit.
If all operations produce no net document change, the result reports `noOp: true`,
`transactionId: null`, and empty change ids. It does not replace the previous real transaction's
rollback token. A changing transaction reports `noOp: false` and a new transaction id; only record
that non-null id for rollback.

Page management must use its own transaction and cannot be mixed with node or document-property
operations. This keeps every node transaction scoped to one active page and prevents an
auto-layout reflow request from crossing a page switch. `create_page` switches to the new page by
default; pass `"switch": false` when creating a background library page. After changing pages,
read metadata again before editing nodes.

`set_document.changes.canvas` is a field-wise patch, but `changes.tokens` replaces the complete
token set. Read and resend every token that must remain. Keeping a token's name while changing its
value propagates that literal color through the canvas, fills, strokes, and shadows in one
simultaneous replacement, so color swaps do not collapse into one value. If multiple tokens share
one old literal but request different new values, the transaction fails because literal-colored
layers do not retain enough information to choose between those token names; split the layer colors
first.

Supported `use_design.operations`:

Every `create_node` must include a stable semantic `id` matching
`^[a-z][a-z0-9-]{0,63}$`. IDs are never generated for Agent operations: choose them before the
transaction so later operations, screenshots, audit findings, and code review can refer to the same
node deterministically.

- `{"op":"create_node","type":"frame|group|component|instance|rectangle|ellipse|text","id":"stable-id","parent_id":"optional-container","before_id":"optional-sibling","properties":{...}}`
- `{"op":"update_node","node_id":"stable-id","changes":{...}}`
- `{"op":"move_node","node_id":"stable-id","parent_id":"container-or-null","before_id":"optional-sibling"}`
- `{"op":"delete_node","node_id":"stable-id"}`
- `{"op":"set_document","changes":{"name":"…","canvas":{...},"tokens":{...}}}`
- `{"op":"create_page","id":"components","name":"Components","switch":false}`
- `{"op":"rename_page","page_id":"page-1","name":"Desktop"}`
- `{"op":"set_active_page","page_id":"desktop"}`
- `{"op":"delete_page","page_id":"draft"}` (the last remaining page cannot be deleted; a
  component-library page cannot be deleted while another page still contains instances of its
  components)

HTML conversion is a separate whole-document transaction, not a `use_design` operation:

- `{"path":"references/chat/index.html","root_selector":"#app","viewport_width":1440,"viewport_height":900,"expected_state_revision":"…","expected_revision":"…"}`

### Multi-page workflow

Use one page per reviewable screen or state and, when helpful, a dedicated component-library page:

1. Create/rename/switch pages in a page-only transaction.
2. Confirm `activePageId` with `get_design_metadata`.
3. Build or edit nodes in a separate transaction.
4. Validate the complete document. Each issue includes `pageId` and `pageName`.
5. For visual review, pass each affected `page_id` to `get_design_screenshot`; no page-switch
   transaction is needed merely to inspect a page.

Node ids are unique across the whole document. Components may live on a library page and instances
may reference them from another page; screenshots and SVG export resolve the master across pages.
An instance renders the component subtree itself, so organizational frames outside the master do
not leak their visibility, opacity, rotation, or clipping into the instance.
Composition may be at most 16 instance levels and 10,000 expanded render layers per page. Reuse
components intentionally; a small acyclic graph can still be rejected when repeated instances
would expand exponentially.
Deleting a component also removes its instances on other pages. Avoid deleting a library page until
all cross-page instances have been intentionally removed or replaced.

### Minimal transaction examples

For a manually positioned child, both parent and child use absolute canvas coordinates. For
example, a child inside a frame at `(80,40)` with 24 px inset starts at `(104,64)`.

For nested auto layout, give the root container its canvas `x/y`, but omit `x/y` from every direct
child whose auto-layout parent owns its position. The nested container may itself grow in the outer
layout:

```json
{
  "expected_state_revision": "<stateRevision from get_design_metadata>",
  "operations": [
    {
      "op": "create_node",
      "type": "frame",
      "id": "workspace-row",
      "properties": {
        "name": "Workspace row",
        "x": 80,
        "y": 120,
        "width": 1180,
        "height": 640,
        "layout": "horizontal",
        "gap": 20,
        "padding": 24,
        "paddingLeft": 32,
        "paddingRight": 32,
        "alignItems": "stretch",
        "justifyContent": "start"
      }
    },
    {
      "op": "create_node",
      "type": "frame",
      "id": "message-column",
      "parent_id": "workspace-row",
      "properties": {
        "name": "Message column",
        "width": 720,
        "height": 592,
        "layout": "vertical",
        "gap": 16,
        "padding": 20,
        "alignItems": "stretch",
        "justifyContent": "start",
        "layoutSizingHorizontal": "fill",
        "layoutSizingVertical": "fill",
        "layoutAlignSelf": "stretch"
      }
    },
    {
      "op": "create_node",
      "type": "text",
      "id": "message-copy",
      "parent_id": "message-column",
      "properties": {
        "name": "Message copy",
        "width": 640,
        "height": 48,
        "text": "A repository-native conversation.",
        "fontSize": 18
      }
    }
  ]
}
```

Replace each placeholder with the exact opaque value returned by the latest metadata read; never
invent, shorten, or reuse a `stateRevision` from an earlier transaction.

## Failure recovery

- If `use_design` or `import_html` cannot save, it restores the pre-transaction canvas and returns no
  `transactionId`. Fix the reported trust, path, or revision problem before creating a fresh
  transaction.
- If `expected_revision` fails, discard assumptions based on the stale read, fetch metadata and
  the affected subtree again, then construct a new transaction against the new revision.
- If `expected_state_revision` fails, the live in-memory canvas changed even if the repository
  revision did not. Re-read metadata and the affected page/subtree; do not retry from the stale
  layout snapshot.
- If a transaction says a flow child owns `x/y`, remove those fields and control position through
  sibling order and parent layout. For a true overlay, set `layoutPositioning: "absolute"` and
  provide absolute-canvas `x/y`. Do not retry the rejected payload unchanged.
- If a root or manual child is missing `x/y`, calculate both absolute coordinates before retrying.
- If an id is missing or stale, read metadata and the smallest relevant subtree again; never guess a
  replacement id from a display name.
- If the latest transaction is clearly the wrong direction, call `rollback_design` immediately
  with its exact `transactionId`. Rollback fails closed after any later design or repo revision;
  never substitute an older transaction id. If rollback persistence fails, the edited canvas and
  transaction token are restored so the same exact id can be retried after resolving the cause.
- If saving reports an external revision conflict, re-read the current document, preserve the
  external changes, and build a fresh transaction. Do not overwrite the repository file directly.
- If calling `save_design` separately, first read metadata and pass its current `stateRevision` as
  `expected_state_revision`; saving also fails closed when the live canvas changed after that read.
  Its `capacityModel`, `storageMode`, `partCount`, `changedPartCount`, `changedPageCount`, and
  `documentBytes` report whether the logical document stayed single-source or committed through
  the page index, and how much of the document changed. No whole-document byte limit is reported.
- If screenshot generation fails, treat visual verification as incomplete. Fix the reported
  geometry/render problem or clearly report the blocker instead of claiming the design looks good.
  If it reports that the design changed during rendering, read metadata again and regenerate from
  the new snapshot.

## Audit result contract

`validate_design` returns:

- `valid`: true only when `issueCount` is zero;
- `renderSafe`: false when clipping, canvas overflow, or text layout makes the render structurally
  unsafe;
- `blockingIssueCount`, `errorCount`, and `warningCount`;
- up to 400 issue records plus `truncatedIssueCount`; summary counts always cover the complete
  audit, so fix the returned records and validate again while truncation is nonzero;
- stable issue `code`, `pageId`, `pageName`, `nodeId`, severity, blocking state, and message.

Handle the current audit codes as follows:

- `layout.canvas-overflow`: move or resize the node inside the canvas.
- `layout.parent-overflow`: compare absolute child and parent edges; when blocking, the child is
  clipped.
- `layout.ancestor-clip-overflow`: a higher frame/component clips through an intermediate group;
  move the node or resize the complete ancestor chain.
- `layout.effect-canvas-overflow`: reduce/move the shadow or move the node inward so the visible
  stroke, shadow, or instance content stays on the canvas.
- `layout.effect-clip-overflow`: a node fits but its stroke, shadow, or instance content crosses a
  clipping ancestor; reduce the effect, add inset, enlarge that ancestor, or deliberately disable
  clipping.
- `layout.text-overflow`: increase the text box height or reduce/rewrite the text.
- `layout.text-width-overflow`: widen the text box, insert an intentional line break, or shorten the
  copy; Design Studio does not silently auto-wrap fixed text nodes.
- `layout.manual-only-ui`: a container-heavy screen has no Auto Layout. Rebuild normal rows,
  columns, Wrap, and repeated regions with horizontal/vertical/Grid containers; retain manual
  coordinates only where canvas artwork or unsupported CSS requires a fallback.
- `a11y.text-contrast`: change foreground/background colors; do not dismiss it as cosmetic.
- `a11y.instance-text-contrast`: the component master may be readable in its library context, but
  this instance is not; fix the master's own surface, the target background, the instance opacity,
  or the rendered text size. The issue `nodeId` is the instance and `sourceNodeId` is its master
  text layer.
- `content.empty-text`: add intentional copy or remove the placeholder layer.
- `content.invisible-text`: use a visible fill or remove the unnecessary text layer.

After each coherent region reaches zero issues, call `get_design_screenshot` with its `node_id` and
`max_width: 1200` to inspect that region at a readable scale. Before finishing, call it with each
affected `page_id` and omit `node_id` for complete-page review. Look for problems an axis-aligned
audit cannot judge: weak hierarchy,
uneven rhythm, accidental density, confusing grouping, implausible product structure, and visually
unbalanced empty space.

Prefer semantic names and stable ids. Use frames for screens and sections, groups for organization,
components for reusable masters, and instances for reuse. Put repeated spacing into auto-layout
containers instead of manually positioning every child. For precise screen mockups, manual layout
is appropriate when every child has verified absolute bounds. Do not edit generated SVG or audit
Markdown as if they were source.

Component instances render the master's complete nested subtree, including instances of other
components and masters stored on another page. Component dependency cycles and self-references are
invalid; reuse a lower-level component instead of creating a circular reference.

The v3 repository format is a recursive page/node tree. `parentId` is an editor-internal field and
must not be written into repo JSON; nested source nodes use `children`.

## Completion gate

Do not finish a design task until all of these are true:

- the intended content and interaction structure are present rather than represented by empty
  placeholder frames;
- `validate_design.valid` and `validate_design.renderSafe` are both true;
- `issueCount`, `blockingIssueCount`, `errorCount`, and `warningCount` are all zero;
- every affected page has a final screenshot inspected at a readable scale;
- the active file is saved and the reported revision/path are current;
- the final response reports the actual validation counts and summarizes what was visually checked.
