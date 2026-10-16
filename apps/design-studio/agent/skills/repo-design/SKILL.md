---
name: repo-design
description: Turn PRDs or rendered HTML into responsive repository designs, refine them through Design Studio's structured tools, generate editable frontend HTML, and visually compare implementation with the Design v3 source. Use for repo design files, Figma-like layout work, design-to-code delivery, and screenshot-driven fidelity checks.
---

# Repository design workflow

For direct Chat or terminal work on saved files without an open panel, use
`design-studio:project-runtime`. It resolves this project's selected package and
provides bounded reads/audits, complete-document create/edit with revision CAS,
SVG/static HTML export, PRD parsing and saved-design comparison. Keep this live
workflow for Panel-submitted requests, unsaved canvas work, incremental layout,
visual screenshots, HTML/Figma import, resources, comments and prototypes.

## Figma exchange, prototypes and review

Start with `get_design_metadata`. For file operations use `save_design` with `action: "create"`,
`"open"` or `"save_as"`, a safe `.codesign.json` path and the latest `expected_state_revision`.
Default `save_design` remains save. New paths are create-only. Save or back up unsaved work before
opening or creating another design; `discard_changes` must reflect the user's intent.

For Figma, first call `exchange_figma(action: "prepare", source_path, target_path,
expected_state_revision)`. Use an independent target name: its `.figma-source.json` binding path
must differ from the input source. Review `audit`, `issueGroups`, complete warning counts and the
target. Commit using `action: "import"`, the same `source_path`, returned `preparation_id` and
unchanged state revision. Source hashes are rechecked. Modern imports default to create;
`mode: "replace"` explicitly targets the current canvas. Legacy path-only imports still replace
it. Imports save by default; `save: false` keeps a reversible live draft. `allow_blocking: true`
permits a draft with blocking issues, never a claim of finished fidelity. Validate and inspect
screenshots before treating a result as faithful. An image fallback is not an editable vector.

Large raw inputs should be prepared with this selected package's `app/tools/prepare-figma.mjs`:
`node <selected-package>/app/tools/prepare-figma.mjs --project <project> --input <source.json>
--output designs/<new-input>.figma-source.json`. Resolve the current package through Panel context;
never guess another version or require a development checkout. The CLI preserves full JSON,
verifies bounded chunks, and does not change the live canvas. Use its outputPath as source_path.

The source package exported by CodeShell Design Bridge includes original nodes, image bytes and
complex-layer previews. The separate HTML to Figma plugin uses html2figma's native adapter/service
for HTML and native DSL; it does not accept CodeShell backups. Keep their input formats explicit.

Use `exchange_figma` with `action: "export"` and a separate
`designs/*.figma-transfer.json` output path to generate editable nodes and an incremental patch.
The source binding beside the design retains unknown Figma fields, variables, components and
original geometry. Never edit its content-addressed objects manually. The Figma plugin previews
the source-node changes and conflicts before applying; deletion needs explicit review. Preserve
the distinction between creating new pages and updating existing source nodes. After applying
changes in Figma, export a fresh source package before another round trip.

Large exchange files use verified, bounded project parts. An export receipt with
`storage: "multipart"` names a `codeshell.design.sidecar` manifest, not a directly importable
Figma JSON file. Download the complete transfer through the panel, or verify every referenced
part's path, byte length and SHA-256 before assembling a standalone JSON file. Multipart source
imports are resolved and checked automatically. Never pass the manifest itself to Figma.

The **原型** editor stores explicit click actions, start page and responsive page routes in
`<design>.prototype.json`. `generate_frontend` with `prototype: true` generates all pages as an
offline interactive HTML artifact. Set `include_comments: true` only when review content belongs
in that artifact. Default frontend generation remains a single static page. Do not infer a
button's behavior from its label; add an explicit prototype action or implement it in the app.

Read `get_design_comments` before addressing review work. Lists return bounded summaries; use
`thread_id` and `reply_offset` to read full text and reply batches. Use `update_design_comments`
with `action: "create"`, `"reply"` or `"status"` and the latest design `expected_state_revision`.
Create requires a real page/node target; replies and status changes use a stable `thread_id`.
Use `validate_design` filters and offset/limit to inspect grouped causes and every issue page; a
truncated detail list never proves that remaining issues are absent. After changing the design,
validate and inspect screenshots, then reply with the resolution and
set `resolved: true`. Never mark an issue resolved merely because a save succeeded.

Complete portable backups include comments, source bindings, prototype data and resource bytes.
Restore to a new design path; the companion files are validated and renamed together. Keep these
files with the design during manual repository moves. Unknown or unreadable companion data must
not be silently omitted from a claimed complete backup.

Use the installed Design Studio Panel App as the authoritative structured editor for
`designs/*.codesign.json`.

1. Call the built-in `Panel` tool with `action: "tools"` and
   `panel_id: "panel-app:design-studio"` when you need the live tool schemas.
2. Call `get_design_metadata` before editing. Reuse stable node ids and inspect the smallest
   relevant subtree with `get_design_context`. For a large top-level screen, begin with
   `max_depth: 1` or `2`, then deepen only the branch you will change. If
   `descendantsTruncated` is true, the returned empty child list is a context boundary—not proof
   that the source node has no children. Metadata lists every page, its node count and `loaded`
   state, plus the active page's compact layer index, whose entries carry `pageId` and `pageName`.
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
   initially loads only the active page and its transitive component-provider pages. Clean pages
   use a bounded cache; dirty pages and their dependencies stay pinned until save. Agent work
   remains metadata → bounded page/subtree → transaction regardless of repository storage mode.
   `codeshell.design.bundle` is a read-only legacy migration format.
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

Keep transactions small enough to diagnose: change one coherent region, validate it, then inspect
the complete screen. Do not replace detailed UI with empty frames merely to remove warnings.

## Product delivery loop

When input is a PRD or the result is frontend code, read [`references/product-delivery-loop.md`](references/product-delivery-loop.md)
and follow its requirement IDs → responsive design → frontend → measured comparison loop.

## HTML fidelity workflow

When HTML is the visual source, read metadata and call `import_html` with the workspace-relative
`.html` path, exact viewport, optional root selector, current `expected_state_revision`, and
current `expected_revision` when non-null. The default root is `html`. The pinned html2figma
runtime measures browser DOM into DesignNode; a pure adapter maps it into v3 with unique IDs
based on structure and semantic identifiers. The viewport is an intentional clipping frame;
offscreen children remain in the editable tree. Re-read metadata after conversion rather than
assuming a source DOM ID becomes the exact v3 ID.

The tool reads up to 20 relative local CSS files, blocks scripts and network requests, verifies
local inline image/font bytes with the browser, then adapts text, containers, supported Flex/Grid,
geometry and basic paints. Images and fonts enter the project resource store before the new
canvas is committed. Workspace text reads cannot load binary files: use inline data resources,
or use the panel's local HTML-folder chooser to include binary images and fonts. Missing local
resources and undecodable fonts/background images fail before changing the design.

The result includes `conversion` with engine, upstream commit, statistics and compatibility
warnings, plus document bytes, audit and an optional rollback transaction. Read these warnings;
gradients, mixed rich text, filters and several CSS edge cases are approximated or unsupported.
Do not describe this as lossless HTML/CSS import. Editing and saving use the same v3 tools as any
other design. Use the complete portable backup for one-file transfer; the Figma plugin directly
validates and opens that file as new editable pages. It cannot install font bytes or import
project comments as Figma cloud comments. The independent measured capture helper remains the
reference used for frontend comparisons, not a silent fallback for this importer.

Read [`references/html-fidelity.md`](references/html-fidelity.md) before changing the importer or
layout engine, running pixel comparisons, or reporting unsupported CSS. Use its maintained
fixtures, thresholds, artifact checklist, and explicit fallback policy; never describe a match as
pixel-perfect without measured evidence.

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
`layoutWrap` to `wrap` or `wrap-reverse` and `layoutReverse: true`; Grid uses `gridColumns` and
child `gridColumnSpan`/`gridRowSpan`. Use `alignItems: "baseline"` for mixed-size text rows.
Set each child's `layoutSizingHorizontal` and `layoutSizingVertical` independently to `fixed`,
`hug`, or `fill`. Hug resizes an Auto Layout container to visible flow content; Fill consumes its
available parent axis. A Fill child under a Hug parent on the same axis uses its current intrinsic
size to break the circular dependency. Use `minWidth`, `maxWidth`, `minHeight`, and `maxHeight`
when responsive children need explicit bounds; do not replace bounded Fill with a fixed width.
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

## Repository images and fonts

Never put Base64 image/font payloads in a design document or node operation. For a small resource,
call `put_design_resource` with inline `base64`. For a larger one, write consecutive Base64 chunks
to at most 12 `.txt` files below `designs/` and pass their ordered `source_paths`; this avoids the
Agent-call argument budget without raising it. Also pass a stable resource id, `kind`, MIME type,
the latest `expected_state_revision`, and font metadata when `kind` is `font`. The tool verifies
the reconstructed bytes, writes content-addressed objects, and adds only a compact descriptor to
the document. Re-read metadata afterward because the state revision changes.

Create an `image` node with `imageRef` set to an image resource id and `objectFit` set to `fill`,
`contain`, or `cover`. Set a text node's `fontRef` to a font resource id; keep its visible
`fontFamily`, weight, and style consistent with the descriptor. Reusing identical bytes does not
duplicate physical files. Missing, mismatched, or corrupted resource references fail validation
or loading instead of silently falling back.

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

`use_design` and `import_html` validate before replacing the canvas. A failed save rolls back
only while the same transaction still owns the document; newer edits or a switched document
are preserved. Prefer one transaction when several operations must stay consistent, such as creating a frame and its first
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

- `{"op":"create_node","type":"frame|group|component|instance|rectangle|ellipse|text|image","id":"stable-id","parent_id":"optional-container","before_id":"optional-sibling","properties":{...}}`
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

- If `use_design` or `import_html` cannot save, it restores the pre-transaction canvas only when
  that transaction still owns the current state, and returns no `transactionId`. Newer state is
  preserved. Re-read metadata and fix the reported error before creating a fresh transaction.
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
- If recovery is offered after a restart, treat it as an operation log replayed onto the last
  saved baseline. If the repository baseline also changed, review the conflict before saving;
  recovery does not overwrite the newer file automatically.

## Audit result contract

`validate_design` returns:

- `valid`: true only when `issueCount` is zero;
- `renderSafe`: false when clipping, canvas overflow, or text layout makes the render structurally
  unsafe;
- `blockingIssueCount`, `errorCount`, and `warningCount`;
- up to 400 issue records plus `truncatedIssueCount`; summary counts always cover the complete
  audit, so fix the returned records and validate again while truncation is nonzero;
- stable issue `code`, `pageId`, `pageName`, `nodeId`, severity, blocking state, and message.

When an audit returns an unfamiliar code or clipping/contrast diagnosis, read
[references/audit-codes.md](references/audit-codes.md) before editing. It maps each current code to
the intended repair and distinguishes component-instance context from master context.

After each coherent region reaches zero issues, inspect it with `get_design_screenshot`,
`node_id`, and `max_width: 1200`; before finishing, review each affected complete `page_id`.
Check hierarchy, rhythm, density, grouping, product plausibility, and empty-space balance.

Prefer semantic names and stable ids: frames for screens/sections, groups for organization,
components for masters, and instances for reuse. Put repeated spacing into Auto Layout; use manual
layout only for verified absolute mockups. Never edit generated SVG or audit Markdown as source.

## Completion gate

Do not finish a design task until all of these are true:

- the intended content and interaction structure are present rather than represented by empty
  placeholder frames;
- `validate_design.valid` and `validate_design.renderSafe` are both true;
- `issueCount`, `blockingIssueCount`, `errorCount`, and `warningCount` are all zero;
- every affected page has a final screenshot inspected at a readable scale;
- the active file is saved and the reported revision/path are current;
- the final response reports the actual validation counts and summarizes what was visually checked.
