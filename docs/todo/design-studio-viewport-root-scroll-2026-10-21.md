# Root viewport scrolling and ordinary HTML flow

Base: `9bc90dc32c749bed97fab2c147ef8d6560830999`; fresh dependent branch and
worktree, with current `origin/main` verified as an ancestor. No native Figma,
registered plugin, CanvasKit or GPU actions belong to this task.

## Observed failure

The frozen GOV check-answers source uses `html { overflow-y:scroll }`. Chromium
computes the other axis as `auto`. Its body is a normal block with visible
overflow. The viewport-relation capture currently rejects every non-visible
ancestor overflow as an independent clip, including this document root.

CPU Chromium (`--disable-gpu`) at widths 1280, 970, 960, 800, 768, 640 and 400
reports standards mode, `scrollingElement === documentElement`, zero scroll
offsets, `scrollbar-gutter:auto`, `contain:none`, no horizontal overflow, and
`clientWidth/clientHeight === innerWidth/innerHeight`. The scroller consumes no
gutter. The document is vertically taller than its viewport; its clipping
boundary is the captured viewport itself.

The same-base full frozen corpus baseline at 1280×768 and viewport-only narrow
768 is **23329 / 23329 / 59515** differing pixels, with `viewport-flow-fixed`.
Source HTML/CSS/fonts, complete raw inventory and strict reports remain under
aggregate `evidence/viewport-scroll-boundary/`. Source bytes are not edited for
this comparison and all external network requests are blocked.

## Narrow supported relationship

[CSS Overflow 3 §3.3](https://www.w3.org/TR/css-overflow-3/#overflow-propagation)
applies root overflow values to the viewport. This is different from an ordinary
ancestor's independent scrollport. Its gutter rules also distinguish overlay
scrollbars from classic scrollbars that consume layout space.
[CSSOM View clientWidth/clientHeight](https://www.w3.org/TR/cssom-view-1/#dom-element-clientwidth)
on the standards-mode document root expose the viewport excluding rendered
scrollbars. Those measurements allow a bounded no-gutter proof.

For the newly supported non-visible overflow case, only the actual
document-element ancestor may retain native viewport flow when
all of the following hold: standards mode; it is the actual scrolling element;
overflow axes use only visible/auto/scroll; gutter is auto; containment is none;
all viewport/client/scroll measurements are finite; viewport and client sizes
match; offsets are zero; and horizontal scrolling overflow is absent. All the
existing positioning, background, dimensions, bounds, margins and ancestor
guards still apply. The existing outer viewport clip owns vertical overflow.

Hidden/clip overflow, stable/both-edges gutters, consumed classic gutters,
body/private scrollports, nonzero scroll offsets and horizontal overflow retain
measured geometry with a diagnostic. No CSS breakpoint engine, scrolling UI,
new canonical field or looser pixel/semantic threshold is added.

## Verification plan

Use real CPU browser fixtures for body and direct-child roots with document-root
auto/scroll overflow, ordinary vertical Auto Layout, same-width reflow, save/reopen
and outer-only narrow resize. Require exact source pixels, stable source IDs and
native Fill/Hug transfer semantics. Cover stable/classic gutters, body/private
clipping and offsets as explicit counterexamples, including narrow captures.
Pair the full frozen GOV source with the unchanged base and compare reference
bytes/decoded pixels. Record remaining whole-page failures and breakpoint limits
without turning them into success through a generic outer-root check.

## Results

The paired frozen GOV report is **23329 / 23329 / 54075**, still a strict failure.
Its original/same-width counts are unchanged, with every one of the 188 nodes'
IDs, parents and geometry unchanged in those modes. Reference PNG bytes and
decoded pixels are identical across all three modes. The narrow count drops by
5440 while still crossing GOV's source breakpoint, which this fix does not model.

The actual restored relationship is the outer `HTML viewport` changing from
Freeform to vertical Auto Layout, and its already-vertical `body#fixture` child
changing horizontal Fixed to Fill. Body width now becomes 768 when only the
outer viewport is narrowed from 1280. This is one proven parent/child flow
relationship, not proof of all ordinary descendants. Remaining table/text/NONE
parent and native negative-bleed limits are outside this task. The generic
`semanticIssues: []` result is not used as proof of whole-page flow.

The three supported minimal production fixtures pass **0 / 0 / 0** after capture,
same-width reflow, outer-only resize and save/reopen, with vertical Auto Layout
and native Fill/Hug transfer semantics. Twenty real DOM guard observations at
640/400 reject all unsupported cases. The classic control removes Playwright's
`--hide-scrollbars` default and measures an actual 16px consumed gutter; no getter
is mocked. Stable gutter retains **0 / 0 / 2000** strict failures. A private body
clip outside the selected subtree retains its honest **25600 / 25600 / 18000**
failures. The fix does not paint over or suppress either counterexample.

Receipts and complete source/reference/converted artifacts:
`evidence/viewport-scroll-boundary/{govuk-inventory-9bc.json,baseline-9bc,after-9bc,paired-baseline-receipt.json,supported-final,unsupported-final,final-fixtures-receipt.json}`.
These receipts also retain both primary specification URLs and CPU browser mode.

The two viewport test files pass **6/6** with `--disable-gpu`; `npm run typecheck`
and `npm run validate` pass. Root owns the later combined main/UI/CanvasKit gate;
repeating the full main suite is unnecessary for this bounded helper change.
Browser, Bridge and standalone generation checks, scoped panel build check,
Prettier for the new regression file and `git diff --check` also pass. The changed
viewport helper ships as an existing native app ES module; no embedded generated
runtime changes are required, and all committed generated outputs verify intact.
