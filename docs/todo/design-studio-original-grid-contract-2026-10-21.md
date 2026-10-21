# Original gallery Grid constraints

This checkpoint changes no product code or Grid admission. It diagnoses the
unchanged original html2figma gallery at upstream
`ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c`, using the frozen 64-template catalogue
from `b1f62f29735561222abfcb46d1016895c2486e92`. All 134 Design Studio package files
remain byte-identical to stable `6b5f57c99c3f28f984b45abbc0a628ea4f9c1fcd`.

## Actual conversion boundary

Original case 19, `[Layout] CSS Grid Layout Test`, has 122 ordinary-flow
obligations: 80 covered, 42 failed. Its original initial root conversion contains
141 nodes, 80 Flex frames and zero Grid frames; viewport mode adds one frame.
These results come from the already frozen production sanitized-iframe capture,
not from a renderer comparison.

A separate response-only diagnostic snapshots the actual production
`convertToDesignDSL` result and corresponding real DOM elements immediately after
conversion. It retains complete computed styles, Typed OM values, authored
`outerHTML`, full-precision rectangles, DesignNode `layout`/`cssLayout`, canonical
mapping and original warnings at 1280 and 400px. The instrumented module's
original/served SHA and exact insertion are recorded. Product files are unchanged;
this read-only diagnostic is distinguished from the unmodified production run.

The same nine Grid containers occur at both widths:

| Canonical ID suffix | Source intent | First blocking contract |
| --- | --- | --- |
| `1-0-1-iiu4j2` | `1fr 1fr 1fr` | Automatic content minimum |
| `2-0-1-1nhkz8b` | `200px 1fr 100px` | Automatic content minimum |
| `3-0-1-unuurq` | Three `1fr` columns, two fixed 80px rows | Automatic content minimum |
| `4-0-1-1g7jjxh` | Four `1fr` columns, partial row/column placement | Partial placement, then automatic content minimum |
| `5-0-1-q6bsgo` | Named areas, `200px 1fr 150px`, `60px 1fr 50px` | Named areas, then automatic content minimum |
| `6-0-1-1ntj2if` | Fixed 150px columns/100px rows, centered auto-width items | Child shrink-to-fit width |
| `7-0-1-1fbhdtu` | `repeat(auto-fit,minmax(150px,1fr))` | Responsive track count/minimum |
| `8-1-eqirlt` | Nested two-column `1fr` layout | Automatic content minimum |
| `8-1-0-1-1dlkikx` | Inner two-column `1fr` layout | Automatic content minimum |

Every suffix above has the prefix `html-0-0-`. The fixed-track container passes
`planHtmlGrid`; it is subsequently refused by `sizeHtmlGridChild`. This distinction
prevents treating a successful parent plan as complete child-layout admission.

For partial placement, a separate source clone replaces placement with the exact
sparse-row cells: `(row,column,rowSpan,columnSpan)`
`[(2,0,1,2),(2,2,1,1),(0,0,2,1),(2,3,1,1),(3,0,1,1),(3,1,1,1),(4,0,1,3),(4,3,1,1)]`.
For named areas, another clone maps each rectangular area to numeric lines.
Both placement-only controls still refuse automatic minimum width at both
viewports. Neither changes the original source, track types or min-size values.
Partial placement also creates five rows from three explicit rows; restoring
placement alone does not establish implicit-row intrinsic sizing. The canonical
manual-anchor mode cannot claim CSS mixed-auto insertion/reordering semantics.

## Meaningful content-edit counterexamples

The source DOM keeps the original CSS. Only one original Text leaf is edited.
Separate counterfactuals then change one CSS property to demonstrate why the
proposed simplifications are unsafe. They are negative controls, not repaired
goldens or product outputs.

In the named-area example, appending an 80-character unbreakable word grows the
original middle track to **1228.125px**. Replacing its bare `1fr` with
`minmax(0,1fr)` holds it at **308px** in the 1280px viewport and **120px** in the
400px viewport. Freezing the current intrinsic minimum would fail the next edit.

In the centered fixed-track example, a longer wrappable label uses source width
**150px**, height **490.6875px**. Replacing `width:auto` with `max-content` produces
width **1894.21875px**, height **55.59375px**. Generic Hug cannot represent this
source's available-cell shrink-to-fit constraint.

The corrected v2 controls use exact `fullPage:false` screenshots, DPR1, fixed
scroll and equal source/control viewports. Full-precision geometry is checked
before and after each screenshot to detect capture side effects.

| Counterexample | Viewport | Changed RGBA pixels | Maximum channel delta |
| --- | --- | ---: | ---: |
| Named-area automatic minimum | 1280×900 | 143836 | 241 |
| Named-area automatic minimum | 400×900 | 34799 | 235 |
| Centered shrink-to-fit | 1280×900 | 69154 | 255 |
| Centered shrink-to-fit | 400×900 | 49731 | 255 |

These are intentional source-versus-counterfactual differences, with no threshold.
The first v1 used element screenshots whose overflow capture dimensions differed;
it is retained and explicitly excluded from same-viewport acceptance. The original
gallery's earlier strict source replay failures remain unchanged.

## Current official Figma contract

Checked 2026-10-21 against the [official GridTrackSize reference](https://developers.figma.com/docs/plugins/api/GridTrackSize/)
and Figma-owned [typings at `dff4874`](https://github.com/figma/plugin-typings/blob/dff4874ca083e18cd74835fd5afc5079d46866b7/plugin-api.d.ts#L8177):
tracks expose `type` (`FLEX`, `FIXED`, `HUG`) and optional numeric `value`. The
reference describes FLEX using CSS `fr`, and HUG as `fit-content(100%)`. It does
not specify the CSS automatic content-minimum algorithm. The
[official Grid guide](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow)
describes proportional Fill tracks and numeric min/max settings on cell objects
and grid frames. The [November 2025 update](https://developers.figma.com/docs/plugins/updates/2025/11/06/version-1-update-120/)
records HUG and weighted FLEX support. These descriptions do not independently
prove bare-fr automatic-minimum fidelity or prove it impossible.

Retained actual native run `289e088a` supplies a narrower observation: Grid
`62:714` is fixed630 with three210px FLEX tracks; its FILL cell `62:715` stays210px
while fixed descendant `62:716` is500px wide. The affine control similarly
overflows. This supports the existing tested structure's zero-min model, not a
general native Text/content-minimum rule. No new Figma execution occurred.

Any future native extension needs direct Text, nested Hug/Fill, fixed-overflow,
min-auto/min0, span and long/short content controls at multiple widths, capturing
actual track/cell getters, raw export and pixels. A numeric minimum measured from
the initial text is not a substitute for dynamic content-based sizing.

## Browser comparison targets

A static CSS-only survey of all64 frozen rendered DOM snapshots finds23 Grid
boxes in six templates. It inserts the exact original gallery stylesheet, keeps
template CSS, and blocks external assets/fonts. This is a constraint inventory;
it does not assert geometry, source replay equivalence or renderer pixels.

| Original template | Grid boxes | CSS capability needed beyond current admission |
| --- | ---: | --- |
| 08 Form Controls Test | 3 | Dynamic auto-minimum columns with form content |
| 19 CSS Grid Layout Test | 9 | Auto minima, mixed partial placement, named areas, shrink-to-fit, auto-fit/minmax |
| 20 Feature Section | 1 | Bare-fr content minima with editable card text |
| 24 Grid with Positioned Elements Test | 5 | Bare-fr minima plus separate authored absolute/fixed overlays |
| 40 Complex Nested Relative Positioning | 2 | Bare-fr minima and `auto-fit,minmax(280px,1fr)` |
| 52 Relative + Grid Mixed Layout | 3 | Bare-fr/span behavior and named areas with implicit auto columns/rows |

Browser CSS can serve as an independent dynamic reference for these constraints.
The current canonical output has already refused them; switching renderers alone
cannot recover discarded Grid intent. A future comparison must use the same
explicitly versioned canonical contract and bytes, preserve original child
identity/order, and keep CK/native refusal visible for unsupported semantics.
Rendering original HTML as the converted Browser scene is not such a comparison.

## Frozen evidence

All paths below are under
`/Users/admin/.codex/worktrees/design-studio-html-original-grid-20261021/evidence/`:

| Receipt | SHA-256 |
| --- | --- |
| `original-grid-diagnosis-handoff-v2.json` | `a3fe910df3aef099b03e7d137234685936acee282be1e471ac5bc450a7291ea0` |
| `original-grid-diagnosis-v2/receipt.json` | `473d792e19396bf664502381d039b8fcff20466999b131238f5edab02592c71c` |
| `original-grid-declarations-v1/receipt.json` | `43e71025e38ff58a36d65d6c202b9df32109bcff757f5439492e8460e9876898` |
| `original-grid-guard-controls-v2/receipt.json` | `57849f83bc64a6d65447dae91fb97c06a8cbef14e6bbf372d36108e8d4836e91` |

The handoff pins the helper scripts, raw source observations, official-document
capture, retained native fixture and all134 product files. Execution is CPU
Chromium `--disable-gpu` and pure JavaScript only. Actual native/Figma execution,
canonical Browser/CanvasKit rendering and converted pixel acceptance are
**NOT_RUN** for this checkpoint. No Grid admission improvement is claimed.
