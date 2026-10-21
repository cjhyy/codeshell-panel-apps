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

## Follow-up: reserved stable gutters

The results above describe the original no-gutter implementation. This follow-up
starts from reviewed `f61a8890641df6eb34a944ab93a85d99adbb85fd` and retains those
earlier failures. A separate 32-capture CPU browser inventory distinguishes the
document's reserved gutter from a visible classic scrollbar. With Chromium's
hidden scrollbar mode, `clientWidth` remains640 while the actual HTML box and
scrollable width are625; `stable both-edges` produces a610px box at x15.
At400px the corresponding widths are385 and370. The previous implementation
kept body/main roots Fixed and missed this space when HTML itself was selected:
its same-width relayout expanded625 to640, differing by9300 pixels.

The capture now corroborates `stable` or `stable both-edges` from the current
standards document scroller, finite exact scroll/client/box measurements, zero
offsets and no horizontal overflow. Actual root margins are accounted for in
the scrollable width. Only a normal LTR block with auto/100% width, no min/max
width restriction, no unsafe containing space/canvas effect and no custom
nonzero scrollbar width qualifies. The reserved space must lie on the inline
end edge or be exactly symmetric. It becomes existing viewport padding; the
captured real root remains horizontal Fill. There is no new model property,
absolute positioning, scrollbar widget, inferred15px constant or pixel tolerance.

Computed Typed OM alone is insufficient: authored2vw is returned as a px value.
A bounded read-only CSSOM pass also checks matching box declarations. Relative
spacing or border widths, variable physical/logical dimensions or offsets, unresolved inset/
overflow/border shorthand substitutions and grouped/conditional box rules retain
a diagnostic instead of becoming fixed ancestor insets. The
scan caps64 stylesheets,10000 rules,16 nested groups,1024 declarations per rule
and8192 selector characters; unreadable or unsupported CSSOM refuses the proof.
This is a conservative capture boundary, not a complete CSS cascade or breakpoint
engine. In particular, an authored box longhand that CSSOM enumerates but
serializes as empty is unresolved, rather than absent: pending physical/logical
border substitutions can hide their variable expression this way. The proof
rejects that representation without depending on a list of shorthand names.
[CSS Overflow gutter rules](https://drafts.csswg.org/css-overflow-3/#scrollbar-gutter-property)
and [Typed OM units](https://www.w3.org/TR/css-typed-om-1/#numeric-objects) are the
primary references; the exact observed geometry remains in the local evidence.

Twelve boxed production fixtures cover HTML/body/main selection, one/both-edge
gutters and fixed HTML/body margins and padding. Their initial, same-width and
outer-only narrow comparisons are all strictly0 changed pixels/max0. The tests
independently measure each selected DOM root, assert exact saved rectangles,
real viewport padding and Fill transfer fields, and preserve save/reopen plus
layout reflow. Custom gutters, real visible16px classic scrollbars, root width
constraints, relative/variable/conditional insets, clipping, scroll offsets,
quirks and horizontal overflow remain negative controls. The10 focused tests
pass; prior failed candidate runs and their explanations are retained outside
the repository, including the extra root-margin accounting correction.

Evidence lives under the task-owned `design-studio-stable-gutter-20261021/evidence/`
directory: baseline DOM inventory, paired production source/converted/difference
PNGs, SVG, canonical/portable/transfer JSON and scoped logs. CPU browser and
transfer preparation are distinct from real Figma execution, which is NOT_RUN
for this change. Existing new-page VERTICAL/padding/FILL setters require no new
native API. Final peer review at75845a7 verified114 negative DOM refusals,
12 fixed-border admissions,36 strict-zero positive comparisons and byte-identical
source references. Four unsupported production counterexamples still differ by
54000/54000/21480/15640 pixels after narrowing and explicitly report
`viewport-flow-fixed`; they remain failures. The fixed8px border control is
0/0/0. Earlier erroneous variable and relative-border admissions remain in the
external versioned receipts rather than being overwritten.

The normal integration at8e50633 includes fresh origin13d591c, whose unrelated
Job/Quant changes leave all123 Design Studio package files and its main/UI
catalog commands unchanged. ROUND44 main720 (719pass,1skip) and UI107 (106pass,
1skip) pass with no failures; complete source/HEAD/helper freeze checks, static
validation and generated-output checks pass. The combined receipt SHA is
`b1853696d2a041b383cf8540d33dc40da06de8283382807e0ac7f1d04912fa68`.

The boxed evidence commands explicitly import the pinned CPU preload. Their
original helper report field `browserGpuDisabled:false` reflects the omitted
`cpuOnly` option, while that preload appends`--disable-gpu` to launch arguments.
The additive`cpu-mode-metadata-clarification-v1.json` records this distinction
and exact invocation/preload pins; original reports and PNGs are unchanged.

The independent peer's four production calls, in contrast, used plain Node
without either `cpuOnly` or that preload; its original reports correctly say
`browserGpuDisabled:false`. Earlier blanket CPU wording for those peer calls
is withdrawn in`execution-mode-clarification.json` (SHA
`b515f4ddfe29ebec984902d1c943bc7ca7aa06a6a091ee4d1208a5f4ffd6d6b6`).
Root subsequently reran the four production negatives plus the fixed8px control
at stable1e3f346 with explicit`cpuOnly:true`: their exact pixel counts and warning
behavior match the retained originals. Receipt SHA
`41c602a564adf444a3e7c01f3a509cb75f205120cf45ad1d406332e5e240dbc8`.
Independent PNG decode/byte checks did not launch a browser and remain valid.
