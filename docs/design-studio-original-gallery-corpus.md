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
