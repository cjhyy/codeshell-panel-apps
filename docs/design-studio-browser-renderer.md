# Browser and CanvasKit views of one editable design

The workbench offers an explicit renderer selector. CanvasKit remains the default;
the browser option renders the same canonical pages, layers, resources, Text
source/ranges and Auto Layout properties. The choice is stored per workspace.
An unavailable renderer reports its failure and retains the design. It never
switches renderer automatically.

The browser view uses the shared canonical frontend HTML/CSS generator, including
real Flex/Grid, gap, padding, wrapping, Hug, Fill and Fixed sizing. It does not
display captured original HTML. For ordinary Auto Layout children, CSS owns their
positions and content-dependent sizes; saved resolved x/y and Hug/Fill sizes are
not layout instructions. Authored manual/absolute layers retain their positioning.
Browser layout does not replace the canonical scene graph or Figma sync contract.

## Preparation and interaction

`createBrowserRenderer({container})` returns `setScene`, `resize`, `render`,
`geometry`, `hitTest`, `stats` and `dispose`. `setScene(normalizedDesign,
{resources,viewOptions})` is asynchronous. Resources are a Map from canonical ID
to `{descriptor,bytes,mimeType}`. The renderer copies the source and bytes,
checks exact normalized descriptors, MIME, byte length and SHA-256, loads its own
font faces, decodes every expanded image, waits for font layout, and measures an
owned staged DOM before publishing it. Failed or superseded preparation never
publishes that candidate. Preparation has a 15-second total deadline.
Pending preparation owns its offscreen DOM and private faces explicitly;
supersession/disposal synchronously removes them and cancels its await race.
The Browser controller calls the optional `cancelPreparation` seam for stale
revisions and immediately retires its own pending surface on disposal.

The current bounded surface accepts 10,000 active canonical nodes, 20,000 expanded
render nodes, a conservative 16 MiB generated-markup budget, 16 MiB copied assets,
and 32 font resources/64 private FontFaces. Refusal preserves the document; these
view limits do not enlarge the document schema. Resource SVG still passes the
existing inert SVG sanitizer. External `foreignObject` remains refused. The old
staged inline/foreignObject experiment is not activated by this renderer.

Complete canonical CSS font stacks keep the existing 120-unit schema limit.
Private aliases use an opaque runtime token and separate 16 KiB CSS budget, so
alias expansion cannot incorrectly reject a valid canonical stack or turn a list
into one literal name. Later named resource families keep all supplied weight/style
faces under a shared private family, allowing browser matching and synthesis.
An explicit primary fontRef retains its existing verified first-face/resource-only
override rules. Named local fallbacks are loaded even without another fontRef;
unquoted generic names never select similarly named resources. The inline editor
uses the prepared browser stack, including its full fallback chain.

Measured world matrices and boxes remain private view state. Hit testing combines
browser paint order with actual matrices and canonical rounded/ellipse/ancestor
clipping. Selection, marquee and editor overlays use those boxes under pan/zoom.
Manual dragging uses the visual box for snapping and a canonical delta for edits.
Single unrotated flow children can reorder within an unwrapped horizontal/vertical
parent, moving the complete subtree and preserving IDs and Auto Layout. Grid,
wrapped, reversed and rotated flow drag reorder is not added here. Unrotated explicit resize
starts at the actual box and changes the requested dimensions to Fixed; it does
not make a flow child absolute. Cancel restores source fields/order and invalidates
the preview revision before restoring the measured handles.

This checkpoint supports instances with actual fixed dimensions. Hug/Fill
instances, inherited stretch and constraints that would change those dimensions
refuse before publication with an explicit capability message; the renderer never
uses a poisoned resolved width to scale component content. A 14,100-pixel Fill
instance counterexample is preserved separately. Returning the canonical instance
to explicit Fixed dimensions recovers the same Browser surface choice. Fixed
instances preserve the master's opacity, clipping, visibility and rotation in
component coordinates before the instance's nonuniform scale and outer transform.
An instance's own visible scalar shadow (`shadow.opacity > 0`) also refuses before
publication, including instances inside another component. The existing shared
frontend exporter omits that effect on its paintless instance wrapper; this view
does not substitute a CSS box shadow for the canonical alpha shadow. The actual
Browser-versus-canonical-SVG counterexample is 1,400 pixels/max128 and is retained.
The UI names the unsupported effect, retains canonical data and keeps the explicit
Browser choice; removing the effect or retaining only opacity0 recovers rendering.

## Evidence and limits

The CPU browser controls use explicit `--disable-gpu`. They include deliberately
poisoned resolved coordinates/sizes; wide/narrow wrapping, content edits, Hug,
Fixed overflow and Grid; rounded clipping and rotation; source/resource snapshot
ownership, digest/missing-font/descriptor refusals; real intrinsic image geometry,
corrupt decode and delayed scene supersession; and actual application selection,
editing, save/reopen, drag, reorder, resize and cancel under pan/zoom.
Hidden Hug nodes and children of hidden parents keep their IDs as non-hit zero
boxes; toggling visibility performs fresh layout. Browser interaction coverage is
limited to the pointer operations above; pre-existing keyboard alignment remains
the canonical geometry operation.

The 120-unit stack control includes selected FontAwesome900, later Inter400,
missing accented glyphs and an inactive component instance. It compares the
prepared renderer against the same bytes registered under literal source family
names only after the source image was captured, then removes those control faces
before later source rendering. It records exact PNGs and strict pixel counts.
The earlier 35,234-pixel attempt incorrectly assumed FontAwesome had no Latin
glyphs and used Inter alone as its reference. That failed test/artifact is retained
as an invalid reference, not presented as a product regression or erased.

The initial native `elementsFromPoint` rounded-ancestor test failed and is retained;
the independent matrix/clip qualification now covers it. A real cancelled-resize
test also found stale preview boxes after canonical rollback; explicit revision
invalidation fixes that case. These are bounded controls, not a zero-error claim
for arbitrary imported websites. The original html2figma gallery has separately
frozen source pages and production canonical captures; its Browser/CanvasKit
paired conversion and retained nonzero pixel/flow failures require their own
receipts. No browser-only result proves Figma parity.
The pending-disposal leak (offscreen host and two private faces until a decoder
settled) and master opacity/clipping omission are preserved peer reproductions.
Synchronous ownership cleanup and an independent same-size/nonuniform transform
tree control cover the respective fixes. Circular Hug-container/Fill-child
dependencies retain the existing canonical resolved fallback; this change does
not define a second solution to circular layout constraints.

Native Figma execution is **NOT_RUN** in this work. Native font/range admission,
original binding, whole-document safety and actual SDK acceptance remain separate
and unchanged. CSS underline geometry cannot silently lower the native boundary.
