# Browser comparative renderer checkpoint · 2026-10-21

Feature commit `32020fd` adds an explicit Browser HTML/CSS renderer beside the
default CanvasKit renderer. Runtime source was frozen at normal-merge
`cfcfb5562e490ef54ad5396c7ff9a5abd75af96c`, including stable
`2572276c6e6fe945cf8a261f3b492eb709e87b05`. No raw source webpage is displayed:
both views consume the same canonical editable scene. Browser geometry stays
private, with actual CSS Flex/Grid/AL sizing and no ordinary-flow ABS rewrite.
See [the renderer contract](../design-studio-browser-renderer.md).

The owner affected gate passed 191/191 in 18,599.176 ms. It includes the 49-test
focused set, actual Browser UI, full font-family restoration controls, software
CanvasKit `MakeSurface` font/range controls and native source/import/plugin VM
tests. Browser launches in this set explicitly pass `--disable-gpu`. Native VM
controls are not actual Figma execution. Typecheck, validation (Design Studio136,
Job94, Quant93 and other packages), all three generated checks, scoped package
build check and diff check passed. The `77d6d01` follow-up changes only this record,
the shared task journal and the existing range-status test's source extractor.

The first affected run had 190/191 passes: its existing test sliced the old inline
`onState` callback and produced invalid JavaScript after the actual app moved to
the shared named `rendererStateChanged` handler. The revised test invokes that
real handler through the controller failure path and still verifies the unchanged
CanvasKit custom-underline refusal, hidden failed surface, visible error and
unmodified canonical design. The original failed log is retained.

External evidence is retained under the task worktree's sibling `evidence/`.
The initial freeze receipt `browser-freeze-v1.json` has SHA-256
`fb767562614cbf423ab547cab6e5e235f3302b1027e41baddce0d90d5c25ea31`.
The passing affected log `browser-final-affected-v2.log` has SHA-256
`b442f7954631243d3a1f26581143103bf5689ff9365d9a13bb993da0ec74bd32`.

Verified bounded results:

- A canonical 120-unit complete font stack expands to private runtime CSS without
  being reparsed under the canonical limit. Selected FontAwesome900 plus later
  Inter400 uses actual nearest-weight glyph fallback, including accented text and
  an inactive component instance. Against the same bytes registered under literal
  source names only after source capture, the strict pixel difference is 0.
- The independent fixed-component transform tree gives strict0/max0 for master
  opacity/clipping/rounded corners/center rotation, instance own opacity/rotation,
  and nonuniform instance scaling.
- A real Fill instance resolved its outer width to300 while its internal paint
  used stale canonical9999, producing 14,100 differing pixels/max255. That original
  failure remains. Hug/Fill/stretch instance sizing now explicitly refuses before
  publication; returning to Fixed300 gives strict0 recovery. The actual UI shows
  the limitation, retains the model and keeps the explicit Browser choice.
- Actual UI controls cover selection/editor geometry, content edits, save/reopen,
  manual drag, ordinary-flow subtree reorder, resize and cancellation under
  pan/zoom. Reorder preserves IDs, vertical AL and Hug. Only explicit resize changes
  the requested dimensions to Fixed. No flow child becomes absolute.
- Hidden Hug nodes and hidden-parent descendants retain IDs as non-hit zero
  boxes. Visibility changes use fresh layout and superseded observations do not
  publish. Intrinsic image80×40/root60 and Fill180→Hug90 are measured only after
  actual decoding; corrupt decode refuses.
- Pending preparation owns its offscreen DOM and private faces. The original
  disposal leak is retained, and synchronous disposal/cancellation now clears
  both before a delayed decoder settles. Browser-only controller controls prove
  stale preparation cannot become ready or block final disposal.

Known limits remain explicit: no Fill/Hug/dynamically stretched instances; no
rotated resize, reverse/wrapped/Grid pointer reorder; no new circular Hug/Fill
solution. The original wrong FontAwesome-no-Latin reference (35,234 pixels), old
rounded native hit-test failure, hidden-Hug refusal, cancelled-resize stale boxes,
pending disposal leak, and peer master-prop failures remain in their original
receipts. No tolerance, manual pixel fitting or opaque background flattening was
introduced.

The original gallery's six canonical Browser CPU smoke states rendered without
app/source drift, but that is an API smoke result. Its early source400 screenshot
and later geometry were not simultaneous and do not prove source fidelity.
Browser/CanvasKit GPU paired acceptance is owned by the parent task and was not
run by this owner. Actual Figma execution remains **NOT_RUN**; native font/range
eligibility, source binding and SDK safety are independent boundaries.

The scalar instance-shadow successor preserves a real 1,400-pixel/max128 CPU
Browser-versus-existing-canonical-SVG counterexample from exact `77d6d01` bytes.
Its receipt has SHA-256
`233e83aea8bad49d12e7d6590059b376c8226d4376c97547117e22dd7e296bdf`.
The shared frontend omits a scalar instance's own alpha shadow. The narrow
Browser-only successor refuses `shadow.opacity > 0` before publication, including
nested instances, without changing the shared model, CanvasKit or native output.
Two new CPU controls prove prior-safe geometry/source retention, inactive0,
clearing-effect strict0 recovery and the actual UI's localized refusal/removal
recovery with no automatic switch. The original failure is not rewritten as a
zero-pixel conversion pass.

The scalar-shadow successor affected gate passed 193/193 in 18,410.994708 ms,
with typecheck, validate136/94/93/all packages, all three generated checks, scoped
build and diff checks passing. Its generated plugin files remain byte-identical
to `77d6d01`; this guard changes only the Browser renderer and its app diagnostic.
The preserved shadow failure is a canonical SVG reference, not native or GPU
acceptance. Parent-owned final peer, full combined gate and qualified original
gallery comparison remain separate.
