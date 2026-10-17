# CanvasKit comparison adapter

This is an experimental renderer outside the installable Design Studio package.
It does not change the production SVG renderer, document schema, or persistence.

```js
import { createRenderer } from "./canvaskit-adapter.mjs";

const renderer = await createRenderer({
  canvas,
  assetsBaseUrl: "/vendor/canvaskit/", // canvaskit-wasm 0.42.0 bin/ contents
  // Optional real same-origin font files for families not included in resources:
  // fallbackFontUrls: { Arial: "/fonts/Arial.ttf" },
});
await renderer.setScene(normalizeDesignDocument(portable.document), {
  resources: new Map(/* id -> { mimeType, bytes: Uint8Array, descriptor } */),
});
renderer.resize(1200, 800, devicePixelRatio);
renderer.render({ pan: { x: 20, y: 20 }, zoom: 0.5 });
console.log(renderer.stats());
renderer.dispose();
```

The loader requests local `canvaskit.js` and `canvaskit.wasm`; it never uses a CDN
or downloads fonts implicitly. The harness must permit Wasm and serve the Wasm
with its correct MIME type. WebGL2 is required: context/surface creation fails
explicitly instead of silently using CanvasKit's software fallback.
The browser can still select a software WebGL driver such as SwiftShader;
`gpuRenderer` exposes this, so WebGL2 alone is not proof of physical GPU use.
The smoke uses `script-src 'self' 'wasm-unsafe-eval'` without `unsafe-eval`,
same-origin connections and local/data/blob fonts and images, and requires zero
CSP violations.

`setScene` records actual Skia drawing commands into a persistent `SkPicture`.
Every `render` clears, transforms, replays and flushes that picture to the GPU.
It does not pan a screenshot or skip drawing the scene. Pan/zoom reuse the
picture; each `setScene` currently rebuilds it completely. Statistics expose
picture builds, input/visible/drawn nodes, text modes, clip/effect use, resource
decode counts, unsupported cases and Wasm heap size. `pictureBytes` is Skia's
approximation and excludes some referenced resources; it is not total memory.
`lastRenderSubmitMs` covers CPU replay/flush submission, **not GPU completion,
presentation latency or FPS**. End-to-end animation measurement belongs in the
comparison harness.

The adapter follows the normalized flat document semantics: absolute node x/y,
ancestor rotations about their centers, transformed ancestor clipping,
effective ancestor opacity, explicit text lines, affine linear gradients,
bottom-to-top fill stacks, image fit and per-node drop shadows. Cross-page
instances detach their source component from unrelated source ancestors.
Editor labels, selection handles and hit testing are outside this renderer.
Missing image resources draw pink/dashed placeholders and are counted.

Supplied TTF/WOFF2 fonts are registered in Skia and the browser under private
aliases. Native text uses SkParagraph shaping, weights/variable font axes,
letter spacing, decorations, explicit lines and browser-compatible hanging
baselines. When a system font has no supplied bytes, or supplied fonts lack
characters that the browser handles through fallback (notably CJK), that text
node is drawn using the browser's same-family Canvas2D text and cached as Skia
images at **2x scale**. This is a disclosed hybrid path, not a fully native text
implementation: `rasterTextNodes`, `nativeMissingGlyphs` and `unsupported`
report it. Raster text loses sharpness at high zoom; it must not be scored as a
fully faithful native renderer merely because pan/zoom is fast. Unknown browser
font families are reported instead of silently replacing them. Per-line raster
images are bounded to 4 megapixels; the viewport is bounded to 16 megapixels and
8192 pixels on either edge. Font Awesome glyphs are checked against their actual
font bytes; the real-sample smoke requires every icon to use native glyphs.

## Fixed dependency receipt

Use exactly **canvaskit-wasm 0.42.0**, npm tarball
`https://registry.npmjs.org/canvaskit-wasm/-/canvaskit-wasm-0.42.0.tgz`.
Upstream: <https://skia.org/docs/user/modules/canvaskit/>.
License: BSD 3-Clause, Google copyright; the distributed license is retained in
[canvaskit-LICENSE.txt](canvaskit-LICENSE.txt).

| File from npm package | Bytes | SHA-256 |
| --- | ---: | --- |
| `bin/canvaskit.js` | 120877 | `443777592179808354031cf411d8d43cac9f6b98d1227123c5c22d401b0fbf7f` |
| `bin/canvaskit.wasm` | 7317345 | `25ebed8e60158c5854f8dc807b936daca21354f8bfb6a2231266b0a93812f301` |
| npm `.tgz` | 9981804 | `ba667f46830ac2a70c6d76ab2c1ac790b0d15a2bf6ed2c842ce97231478b1f80` |

npm integrity: `sha512-N3ikotmzYwDVAcpQKDMptBT2P5pIEWS9ywdmrQA2awwaMF9cxKEFuxZZHv9ay1Em9kDjxDsPtwUzDm1uNj136g==`.
No dependency bytes or personal designs are committed by this adapter change.

## Correctness smoke

With repository development dependencies and the fixed CanvasKit dependency:

```sh
node --test scripts/design-renderer-compare/canvaskit-smoke.test.mjs
```

Alternatively set `CANVASKIT_ASSETS_DIR` to an extracted package's `bin/`.
The optional `CANVASKIT_PORTABLE_FIXTURE` selects a local portable backup for
read-only real-document checks. `CANVASKIT_SCREENSHOT_OUTPUT` optionally saves a
QA overview, strictly beneath the checkout's ignored `artifacts/` directory.
No personal fixture content is embedded in the tests.

Synthetic smoke checks actual pixels for rotation, clipping/opacity, gradients,
blurred shadows, native multi-line text, browser text fallback, missing-image
placeholders and a real color edit. A separate cross-page component test compares
the rendered pixels with the production SVG export. Pan must reuse the picture;
scene edits must rebuild it; excessive viewports and use after disposal fail.
The real-sample test verifies node retention, all declared fonts, icon glyphs,
effect coverage and absence of dropped text lines; it does not assert visual
parity or infer FPS from synchronous draw-call timings.
