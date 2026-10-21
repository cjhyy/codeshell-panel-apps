# Original gallery source corpus

The full original html2figma gallery is now frozen separately from the previous
20 compact adaptations. Its 64 exact templates, source modules, original gallery
shell and provenance inventory are in
[the original-gallery fixture](../tests/fixtures/design-studio-html2figma-original-gallery/README.md).
The local authoritative upstream checkout remained at
`ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c`; all 221 tracked files matched its Git
archive before and after the read-only freeze. Existing untracked user files
were preserved. The archive SHA-256 is
`0d8072fd5aee8fb234150a122b8a06fef18113b6db7bb85b7550d54c2f8b5d22`.

The original TypeScript gallery was compiled from 46 pinned original source inputs
and served with its unchanged index/styles. CPU Chromium 148.0.7778.96 ran with
`--disable-gpu`, device scale 1 and viewports1280/768/400×900. The gallery input
HTML hash matched the exact original template in all 192 states. Each state has
a source root PNG and rendered DOM snapshot;15 selected states also have an actual
whole-gallery screenshot. Six source-root overflow cases remain explicitly
recorded, so root images are captured rectangles rather than claims of full
template content.

The final source run recorded 195 external responses: 96redirect observations and
99body observations, 59unique URLs and 30unique bodies. Frozen response/redirect
replay had no per-URL body or destination conflict, no request failure and no
unloaded IMG. The first run's 32 `response.body`-unavailable records were successful
redirects that the initial logger tried to read; that run is preserved unchanged.
The second run records redirects separately and preserves original asset bytes.

Source evidence lives under the task's external `evidence/` directory:

- `original-freeze-v2/freeze.json`: SHA-256 `7eb9294db6a0c652abbc133fb928ced636f53c4127e0cfe998a9d4d6a2bf5756`.
- `original-gallery-browser-v2/receipt.json`: SHA-256 `ec8a2d8b12386e4bfae78e7448c54c7d4551042612ddfc2a24a551d24e4d6de8`.
- `original-gallery-browser-v2-review.json`: 430 artifact hashes, SHA-256 `4f522e2c3c10c6027051a9956e15788bcecab03ebd262090d326948f97386771`.

Next, the materialized original gallery DOM/CSS/assets must enter the current
production `captureWorkspaceHtmlResult` path with its actual preview-body root
selector. Any local transport URL mapping needs a separately proven unchanged
source replay; unresolved resources must stay explicit. Use the resulting exact
canonical document for both browser and CanvasKit rendering, with initial,
same-width reflow, narrow-width reflow and content-edit comparisons. Direct legacy
capture or upstream JSON generation cannot substitute for the production path.
Ordinary source flow must remain real Flex/Grid/Hug/Fill rather than becoming
absolute positioning to fit a screenshot.

This checkpoint is source inventory and browser observation only. Studio and
renderer comparison results remain pending. Actual Figma execution is **NOT_RUN**;
there is no native, renderer or pixel parity claim.

## Bounded production capture checkpoint

Seven originals were materialized at 1280 and 400: Welcome Card, Flex Basis Zero,
Navigation Bar, Multiple Inline Spans, CSS Grid Layout Test, Ruby Jewelry and
Fixed Position Test Enhanced. The materialization removes scripts, serializes
independently known form state and maps frozen resource transport URLs. It does
not change template text, CSS sizes or heights. Root-rectangle paint, whole visible
viewport paint and raw geometry are checked separately before product capture.

The first materialization lost Ruby's leading LF in the gallery source textarea:
HTML parsing ignores its first LF. Correct state encoding now verifies the exact
original textarea value hash before comparing pixels. Initial failed PNGs remain
preserved. The second materialization still has strict source failures: Welcome
400 has one whole-viewport pixel/max1 outside its identical root; Ruby1280 has a
historical source replay difference 39/max1 despite a fresh original/localized
pair at 0; Ruby400 has 2/max4 initial viewport pixels and 19/max1 edited root pixels.
All raw geometry matched. No tolerance or raster setting was changed to erase
these failures, and all three width states were excluded from product capture.

The remaining 11 eligible width states entered the actual current production
`captureWorkspaceHtmlResult` HTML→canonical path at commit
`1541a5ffca45e060f65c6986bc622b2a2f0575ee`, a normal merge of stable 6b5 and the
source fixture checkpoint. Both default viewport and explicitly unclipped-root
modes were captured, for original and source-edited content: 44 successful CPU
capture operations. Actual pre/post inventories show all 134 app files unchanged.
Each operation saves the exact canonical document, full import warnings, source
mapping, resources, flow obligations/audit and same-width reflow document. The 22
initial imports also have an independently identified canonical Text edit control.

Capture success is not layout success. Flex Basis Zero covers 26/26 source flow
obligations and Navigation Bar 14/14. The original Grid template has 122 obligations,
42 failures and no canonical Grid nodes; its first warnings identify unsupported
bare-fr automatic minimums, partial anchors, named areas, shrink-to-fit alignment
and auto-fit. Welcome has two manual-flow failures; inline text remains partial.
Same-width reflow also changes measured geometry: for example Flex Basis Zero's
root height 457.53→457.57 and Navigation Bar changes some dimensions by 0.01–0.02.
These differences remain recorded for renderer comparison rather than treated as
pixel matches.

All 44 canonical→Figma transfer attempts refuse explicitly: 36 lack a proven single
native face for the original CSS font stack and 8 retain the unsupported CSS shadow
mask guard. No actual Figma creation occurred. Browser-canonical and CanvasKit
rendering remain pending; SVG output is not used as an actual CanvasKit proxy.

The production receipt is `original-production-v1/receipt.json`, SHA-256
`c0ac24d6641dfb79b7322260b240caeb947e8bbeb0cf3e64b3c93294aebe567d`.
Its529-artifact inventory and per-case summaries are in
`original-production-v1-review.json`, SHA-256
`dde65184f17c5b997b5de91b6154c662e753ab3d6b07234325faff9c59aeeec4`.

A fixed three-sample repeatability diagnostic records four active Ruby CSS
animations and unchanged-source root differences41/0/19pixels at400. It also
records whole-viewport changes after element screenshot scrolling. These are
observations, not proof that animation explains every historical difference.
Welcome400 repeats were strict0; its earlier one-pixel failure remains preserved.
No new raster setting, CSS override or phase workaround was introduced.
