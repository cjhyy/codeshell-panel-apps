# Byte-verified variable font selection

Candidate source and formal regressions, 2026-10-22. Actual product UI acceptance
is separate. No original font bytes, html2figma JSON, persisted font descriptor,
or document schema is changed by this repair.

## Problem and runtime contract

CanvasKit previously recognized variable fonts from built-in resource ID
prefixes or a fallback URL. An external Noto TTF with an actual `wght` axis
100–900 was treated as static 400. Both a 700 range and an unbound 700 base node
could fail with `TEXT_RANGES_UNSUPPORTED`. HTML instead declared every selected
resource as weight `1 1000`, including static fonts.

`font-capabilities.mjs` derives capability from supplied bytes:

- TTF/OTF SFNT directories and `fvar` records are bounded and validated. Axes
  retain their actual signed 16.16 min/default/max values. OS/2 weight/style are
  recorded separately as native font facts.
- Existing compressed Inter/Font Awesome files use their complete frozen
  SHA-256 and original-byte length. Their axes and native weight were decoded
  independently with fontTools/Brotli. Different bytes lose that proof. Resource
  IDs, URLs and a descriptor weight cannot grant a variable axis.
- Unknown WOFF/WOFF2 and font collections do not acquire variable capability.
  This candidate does not add a generic compressed-font decoder. Invalid or
  truncated SFNT axis records also cannot widen a face.

One strict resolver selects the declared family/style and requested weight from
an exact supplied static face or a proven variable instance. It does not select
a nearest weight. A 400 source descriptor remains 400; a 700 request can use the
same original variable bytes without creating a fabricated 700 asset or changing
`fontRef`. Existing unbound static text keeps its prior CanvasKit browser-cache
path; automatic primary binding is expanded only for proven variable resources.

CanvasKit base/range text, HTML primary/range private aliases, document-owned
FontFaces, import measurement FontFaces and portable font CSS use the same axis
facts. Secondary HTML glyph-fallback aliases retain their authored CSS face
declarations; expanding those aliases would change existing fallback pixels.
Runtime range aliases now also cover explicit cross-family spans.

A static file's native OS/2 weight is not its authored CSS `font-weight`
descriptor. An intentional static CSS alias keeps its supplied descriptor;
the native weight remains separately visible in diagnostics. This does not
authorize generating extra static faces from identical bytes.

Measurement receives the supplied font faces from import preparation. If the
supplied family does not cover a requested weight/style, it does not use a
synthesized measurement to rewrite source text/geometry or produce a new metric
receipt. The importer emits `font-resource-unsupported`. HTML rejects an
uncovered supplied primary/range request as `BROWSER_FONT_UNSUPPORTED` and keeps
the previous scene. CanvasKit retains its explicit range rejection for missing
fonts, out-of-range weights and missing glyphs.

## Diagnostics and schema boundary

Renderer stats expose runtime-only `fontCapabilities` and `fontSelections`:
resource ID, declared weight/style, actual native metadata, axis ranges, proof,
requested family/weight/style and selected resource/instance. Selection receipts
are bounded at 256 with an omitted count. Measurement returns corresponding
selection and unsupported-request diagnostics.

These fields are not added to v3 documents, resource descriptors, the public
document schema, native Figma transfer or native export hints. Original resource
hashes, source attachments and exact descriptor-to-`fontRef` import assertions
remain valid. Source CSS declarations, browser-selected native glyph faces and
binary axis capabilities are distinct evidence; they are not collapsed into a
claim of source fidelity.

## Formal evidence

The new `font-capabilities.test.mjs` covers real variable/static fonts, offset
views, fractional/negative axes, bounded malformed tables/records, duplicate
tags, altered pinned bytes, unsupported containers and strict missing/style/
out-of-range selection. `font-capability-consumers.test.mjs` covers measurement,
owned faces, exported CSS and real HTML static-font admission/rollback.

Before the consumer repair, all four initial consumer cases failed: measurement
and owned fonts stayed at 400, portable external-variable CSS stayed at 400,
and a static HTML selected face was incorrectly registered as `1 1000`.
The coordinator's independent `iana-font-oracle.test.mjs` also captured the two
real WebGL range/base failures before the repair.

Local ignored evidence is under `artifacts/font-capability-proof/`, including
`consumers.red.tap`, `builtin-axes.fonttools.json`, parser/consumer green logs,
the preserved intermediate control failures, and `final-fonts.green.tap`.
The final combined affected suites passed **82/82** with original IANA assets.
The default offline catalog includes the new unit and browser regressions.

```sh
node --test --test-concurrency=1 \
  tests/apps/design-studio/font-capabilities.test.mjs \
  tests/apps/design-studio/font-capability-consumers.test.mjs \
  tests/apps/design-studio/iana-font-oracle.test.mjs

# Optional local original-IANA oracle; no private font is committed:
IANA_FONT_ASSETS_DIR=/absolute/path/to/ignored/IANA/assets \
  node --test --test-concurrency=1 tests/apps/design-studio/iana-font-oracle.test.mjs
```

The independent private oracle uses Chromium 148.0.7778.96 and actual Metal
WebGL2. Original Noto 700 ranges, a 700 base without `fontRef`, and Noto/IBM mixed
ranges use native paragraphs with no raster replacement. Their measured
advances differ from the source Chromium control by approximately −0.00476,
+0.08966 and −0.02246 px respectively. This is an advance comparison, not
whole-paragraph pixel equivalence.

The unchanged complete IANA colors wrapper renders all 151 nodes / 38 text
nodes with 34 native text nodes and 4 ordinary raster fallbacks. Original Noto
Latin lacks `←` and the three `▪` glyphs; independent cmap controls and explicit
`native-missing-glyph` diagnostics identify those nodes. No range text is
replaced by raster. **38/38 native rendering is not claimed.**

The source-font oracle also distinguishes an omitted CSS weight descriptor
(`FontFace.weight` is `normal`) from an explicit `400` descriptor in the tested
Chromium build. With the original Noto file, the former selects Regular/Medium/
Bold for requests 400/500/700 and agrees with the explicit validated range; the
explicit 400 declaration selects Regular. Actual font selection is measured,
not inferred merely from computed `font-weight` or a CSS default.

## Remaining acceptance

Design Studio is a native `app/` Panel; it does not require generated dist.
Start a new preview origin and import the original wrapper through the normal
UI, leaving old failure tabs and backups intact:

```sh
npm run preview -- --app design-studio --port 4177
```

Capture actual GPU status, native/raster counters and font diagnostics; export a
complete backup and compare content against the previous original. No storage
quota, native Figma installation, glyph completion, source synthesis-policy
schema or whole-page visual-equivalence claim is made by this runtime repair.

## Current-main integration: 2026-10-26

The typography draft expands the existing base and range size contract to
1–240px. Integration found two consumers still limited to 6px: complete native
source admission and the inspector input. Both now use the same 1px lower
bound. `native-text-import.test.mjs` retains a synthetic variant of the complete
observed source at 1px and 4px, exact save/reopen, original-source immutability,
and refusal below 1px or above 240px. The original source helper and failing
small-size log are frozen under the integration evidence's `fonts/` directory.
HTML adapter admission is verified separately by its owning conversion cases.

Range size 12px and range weight 700 are newly supported author intent. The old
unknown-field refusal now uses a genuinely unknown `futureFontOption`; the
native unsupported-weight control uses 750. The original draft and historical
failure inputs remain frozen. Other malformed/stale/overlapping/source-budget
and SDK-observation checks continue unchanged.

A public document case combines mixed typography with the current infinite
workspace: a bounded synthetic two-line measurement at (-500, 65000) keeps the
measured line offsets in content bounds through save/reopen. It verifies the
coordinate/receipt composition and is distinct from real font-pixel evidence.
The current integration keeps the mainline's measured ink bounds, independent
strokes/shadow stacks, clipping and infinite coordinate budget.

Final integrated browser, GPU and repository gate results are recorded by the
integration acceptance document. The historical 82/82 report above remains a
report about the original candidate and its retained assets.

The legacy HTML engine also had two independent 6px clamps in paragraph and
form-value capture. Both now preserve supported 1px/4px CSS sizes. Two real
Chromium regressions in `html-font-family.test.mjs` retain normalized/saved sizes,
source text and unchanged DOM for 1/4/6px, the existing 300→240 upper-bound
policy, and inherited 16px defaults for empty/invalid CSS declarations. The
original helper and the actual 6≠1 failures are preserved under
`fonts/legacy-minimum/`. Test setup iterations (minimum bounded root height and
a wrapped display-line lookup) are recorded separately from the product bug.
