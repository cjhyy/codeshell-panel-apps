# H2F-INTEGRATION-004 — retained CanvasKit canvas doubles geometry at DPR 2

Status: candidate source fixed; formal regression red → green; HN browser UI acceptance passed on 2026-10-22. This candidate is not merged or installed in the CodeShell host.

## Trigger and cause

Importing a new document recreates the CanvasKit renderer on the same canvas.
The canvas already has a HiDPI backing store. `createRenderer()` initially reads
`canvas.width/height` as its initial dimensions and calls `resize(..., 1)`, making
the CSS dimensions equal to the backing dimensions. The controller subsequently
calls `resize(realCssWidth, realCssHeight, dpr)`. At DPR 2 the physical dimensions
are unchanged, so the backing-size optimization returned before correcting CSS
width/height. A 900×600 CSS viewport kept its 1800×1200 backing store but also
became 1800×1200 CSS pixels. Positions, sizes and pan were all displayed at 2×.

The repair synchronizes CSS dimensions before the backing-store early return.
It does not change geometry, layout, document coordinates, resources or storage.

## Stable minimal case and oracle

The regression lives in
[`canvaskit-cache.test.mjs`](../../tests/apps/design-studio/canvaskit-cache.test.mjs),
tests `retained canvas renderer recreation keeps CSS geometry at DPR 1/2`.

It creates a white 1409×1233 root, a nested table at absolute x=106, and an orange
header at absolute x=106, height=24. It renders at zoom 0.38 with pan (60,40),
disposes/recreates the native GPU renderer on the same canvas, then reads real
CSS bounds, backing dimensions and screenshots using CSS screenshot scale.
Expected screen geometry is computed from `pan + zoom × model`, independently
of the renderer: left 100.28, top 40, width 228, height 9.12. Antialiasing leaves
the fully orange interior at (101,40), width 227, height 9.

Run:

```sh
node --test --test-name-pattern='retained canvas renderer recreation' tests/apps/design-studio/canvaskit-cache.test.mjs
```

Observed red baseline before the fix:

```text
DPR 1: CSS 900×600; backing 900×600; before/after orange (101,40,227,9): PASS
DPR 2: CSS 1800×1200; backing 1800×1200
       before orange (101,40,227,9); after orange (201,80,455,18)
AssertionError: CSS width is independent of the retained backing store
1800 !== 900
1 pass, 1 fail
```

Observed green after the fix:

```text
DPR 1: CSS 900×600; backing 900×600; before/after orange (101,40,227,9)
DPR 2: CSS 900×600; backing 1800×1200; before/after orange (101,40,227,9)
2 pass, 0 fail
```

The complete CanvasKit cache, controller and SVG suites also pass together:

```sh
node --test tests/apps/design-studio/canvaskit-cache.test.mjs tests/apps/design-studio/renderer-controller.test.mjs tests/apps/design-studio/canvaskit-svg.test.mjs
# 41 pass, 0 fail
```

## Original HN evidence and remaining acceptance

The original failure screenshot and complete backup are retained without
overwriting them in the local html2figma checkout, under
`artifacts/fidelity-2026-10-22/hackernews-studio-clean-rendered.png` and
`hackernews-studio-clean-complete-backup.json`.

The backup's binding maps all 483 raw nodes to model nodes. Summing the raw
parent-relative x values gives the exact model absolute x for all 483 nodes
(maximum difference 0). All non-text y positions also match exactly. In
particular raw table x=106 plus tbody x=0 becomes model table x=106 and tbody
x=106 correctly. CanvasKit draws each ordinary node with one translation using
its absolute model position. The original apparent 80px gap is consistent with
106×0.38×2, while the source 24px header appeared approximately 18px tall.

Real UI acceptance should use a separate origin, restore the existing complete
backup and confirm zoom, header size, position and save/reopen once. The old
origin's unsaved data must remain intact. A separate origin isolates this DPR
check; it does not establish that localStorage quota failures are resolved.

On 2026-10-22 the same backup was restored through the UI at the isolated
`127.0.0.1:4174` preview. The UI retained 483 nodes and 123 text nodes, rendered
the full page at 38% with CanvasKit WebGL2, and reported CSS 749×594 with a
1498×1188 backing store. Saving and reloading
`designs/frozen-hn-clean-dpr-20261022.codesign.json` succeeded. A new complete
backup exported after reopening was deeply equal to the original for document
pages, resource descriptors, resource payloads and source attachments. No
design coordinates, text or assets were repaired manually.

The html2figma checkout retains the actual report in
`artifacts/fidelity-2026-10-22/hackernews-studio-dpr-verification-20261022.json`
and the screenshot in `hackernews-studio-dpr-reopened.jpg`. These are local
evidence, not a whole-page pixel-equivalence claim. The original `localhost:4173`
quota failure and its data remain intact; actual CodeShell-host persistence is
still a separate requirement.

```sh
npm run preview -- --app design-studio --port 4174
# http://127.0.0.1:4174/
```
