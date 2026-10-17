# Grida comparison adapter

This is an isolated renderer experiment, not an installed Panel or a replacement
for the document model. It projects the normalized active page into a real native
Grida scene; it does not rasterize the whole design.

Prepare the pinned same-origin runtime and official-source encoder:

```sh
node scripts/design-renderer-compare/prepare-grida.mjs artifacts/design-renderer-compare/vendor/grida
node --test tests/apps/design-studio/grida-scene.test.mjs
```

Serve that directory as `/vendor/grida/`, and call
`createRenderer({ canvas, assetsBaseUrl: '/vendor/grida/' })` from
`grida-adapter.mjs`. The interface is `setScene(design, {resources})`,
`resize(width, height, dpr)`, `render({pan, zoom})`, `stats()`, and `dispose()`.
`design` is the result of `normalizeDesignDocument`. Resources are
`Map<id, {bytes: Uint8Array, descriptor, mimeType}>`. Load the resource FontFaces
into `document.fonts` before `setScene`, matching the browser reference. Optional
`design.sourceMissingImages` reports known source losses without adding artwork.

The preparation tool pins `@grida/canvas-wasm@0.91.0-canary.22`, verifies npm
SHA-512 integrity and the Wasm SHA-256, and copies its Apache-2.0 license. The
runtime's published package does not include a JSON scene encoder. The preparation
tool therefore builds the official encoder and schema from source commit
`f0e2aeab23575fb9c2970d5f55275f1679c87155`, with pinned source hashes, FlatBuffers
runtime and compiler. Metadata and licenses are emitted beside the runtime.
That source commit's exact relationship to the npm build is **unverified**; the
synthetic scene round-trip and runtime smoke establish tested compatibility,
not complete schema compatibility.

The runtime uses WebGL2 and Wasm. It has passed a real Chromium smoke under
`script-src 'self' 'wasm-unsafe-eval'`, with no JavaScript `unsafe-eval` and no
external requests. The raw Wasm is 17,623,372 bytes and exceeds the Host's current
16 MiB per-file budget. The experiment does not change that limit or install the
runtime into the Panel.

Supported projections include ordered parent-relative containers, solid and
linear gradient fills, strokes, clipping, opacity, rotation, shadows and images.
Source IDs, hidden layers and hierarchy remain present. Text with supplied native
fonts uses Grida text nodes. Browser-only fonts use individually cached Canvas2D
text images, including padding for ink, stroke and shadow. The pinned runtime
also renders bundled Font Awesome 5 aliases incorrectly as tofu despite reporting
the family as available, so these glyphs use the same explicit text-image path.
WOFF/WOFF2 fonts also take that path conservatively: this build silently records
font families even when Skia cannot decode their bytes, and exposes no successful
typeface or glyph-coverage receipt. This includes the bundled Inter webfont.
The stats report native and raster text counts, alias fallback reasons, decoration
approximations, image/font failures, compatibility issues and preparation time.
Text decoration in a raster fallback is approximate. Native text baseline,
wrapping and glyph coverage must still be compared visually; family registration
alone does not establish fidelity.

A real saved-page smoke retained all 1,208 original nodes, gradients and clips.
Known missing source images remain the saved transparent frames. Private input,
prepared vendor assets and screenshots belong in ignored `artifacts/`, never Git.
