# Design Studio renderer comparison

The selected integration is **CanvasKit at every zoom and during editing**. The
editor's scene, selection overlay and hit testing do not use SVG. Both GPU prototypes draw the actual retained scene. Neither uses a
bitmap screenshot of the whole design as the performance workload.

The private saved design contained 1,208 nodes, 388 text layers and eight font
resources, with a 8,567 × 11,322 canvas. Hidden nodes remain in the document;
CanvasKit draws the 1,193 visible nodes. The two images already missing from the
source remain the saved transparent frames and existing import warnings.

## Retained vector baseline before the GPU tile-cache improvement

Apple M4 Pro, ANGLE Metal, private Chromium, 1,280 × 900 CSS pixels, DPR 2.
Each engine ran three repetitions of 180 frames per scenario after 40 warm-up
frames. Engine order reverses on alternating repetitions. Each table cell is the
P95 of 537 pooled finite animation-frame intervals. Smaller is better.

| Scenario                          |     SVG |   Grida | CanvasKit |
| --------------------------------- | ------: | ------: | --------: |
| Overview pan, 7%                  |  8.6 ms | 10.0 ms |   23.6 ms |
| Detail pan, 80%                   |  9.8 ms |  9.9 ms |   10.0 ms |
| Detail zoom, approximately 55–80% | 15.7 ms |  9.4 ms |    9.7 ms |

Detail pan is effectively tied on this machine. Both GPU engines improve the
zoom workload. CanvasKit reduces its P95 interval by about 38% against SVG;
Grida's 0.3 ms advantage over CanvasKit is too small here to establish a general
winner across hardware. The baseline exposed CanvasKit's overview bottleneck;
the GPU-only implementation addresses it with bounded GPU tile caching.

CanvasKit was selected for the GPU integration because it restores native font
glyphs more reliably, has a smaller pinned runtime, and fits the existing Host
package budget. Its Wasm is 7,317,345 bytes; Grida's is 17,623,372 bytes and exceeds
the unchanged 16 MiB per-file budget. Grida's npm canary also needs a separately
built official-source FlatBuffers encoder whose exact npm schema relationship is
unverified. See [Grida limitations and preparation](grida.README.md).

CanvasKit uses an SkPicture with `beginRecording(bounds, true)`, enabling Skia's
R-tree to skip offscreen drawing commands. Leaving that flag off was materially
slower. Its native paragraph gradient coordinates were verified against SVG at
nonzero positions. Font Awesome icons remain native glyphs; 114 visible text
layers use individual 2× browser text caches for unavailable font bytes or glyphs.
Grida also retains its original text nodes but needs more per-text font caches.

The production policy is GPU-only. A separate Canvas interaction layer provides
selection and handles; document geometry determines hit testing, including
rotation and ancestor clipping. Unsupported Hosts and GPU failures display an
explicit unavailable state and retry action. The document, resource custody and
history remain independent of the renderer.

## Reproduce

Install the pinned development dependencies, then prepare local assets:

```sh
npm ci
node scripts/prepare-design-studio-canvaskit.mjs --check
node scripts/design-renderer-compare/prepare-grida.mjs artifacts/design-renderer-compare/vendor/grida
```

Copy the pinned `canvaskit.js` and `canvaskit.wasm` from the installed Panel's
`app/canvas/vendor/` into `artifacts/design-renderer-compare/vendor/canvaskit/`.
Run with an explicit portable backup and a new output directory:

```sh
node scripts/design-renderer-compare/run.mjs \
  --input /absolute/design.portable.json \
  --output artifacts/design-renderer-compare/new-run \
  --frames 180 --repeats 3
```

The runner permits only intercepted local files at one exact origin, with the
Host's Wasm-only CSP relaxation and no external requests. It verifies the input
SHA-256 again after testing. Every measured scenario and inspection view must
pass a nonblank pixel check; screenshots and raw samples remain in ignored
artifacts. Inspect the screenshots as well: nonblank output alone does not prove
complete visual fidelity. Syntax, scene mapping and actual GPU editing tests are
also part of the normal Design Studio suite.

The first Grida run rendered blank after `setScene` followed by `resize`; those
timings were invalidated. The adapter now restores the native surface and cached
resources after a backing-store resize, with a pixel regression test. A second
run preceded the CanvasKit gradient correction. The authoritative local run is
`artifacts/design-renderer-compare/final-m4pro/`, engine source commit `28eaa13`.
Its `report.json`, raw samples and `aggregate.json` preserve the evidence. The
private input and screenshots are intentionally not committed to Git.

These results describe this saved design on one GPU. rAF intervals include browser
scheduling and compositing; synchronous draw submission excludes GPU completion
and display latency. The design has no populated image nodes, so the real-file
test does not establish large-image document performance. Synthetic tests cover
basic image fitting, clipping, rotation, alpha, shadows and cross-page components.

Skia's [CanvasKit implementation](https://github.com/google/skia/blob/main/modules/canvaskit/canvaskit_bindings.cpp)
maps `computeBounds` to its R-tree factory. Both experimental runtimes retain
their upstream licenses and version/hash receipts.
