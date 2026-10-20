# Native empty stroke style preservation

The original frozen native padded-row roundtrip has 64 exact empty-stroke nodes. A ten-field audit
finds 152 inactive-style differences: 64 alignments, 58 scalar widths and 30 explicit inclusion
flags. Its 640 raw checks and original receipts remain unchanged. This change preserves that
bounded style without inventing a transparent paint, changing visible geometry or treating hidden
and alpha-zero paint arrays as empty.

The optional model is documented in `apps/design-studio/app/formats/design-format.md`. It is kept
separate from painted stroke fields because those fields affect Fill basis, SVG/Canvas bounds and
content insets. Raw omission remains distinct from a present boolean. A proven Auto Layout REST
omission has a separate false-only default contract; freeform frames receive neither a guessed
flag nor an inapplicable inclusion setter. Explicit-inclusion final-NONE activation is rejected
without mutation until a natural Auto Layout mode change can retain the flag. Unknown extra styles stay source-only, and malformed
source fields are diagnosed.

Activation computes a complete candidate before changing the canonical node. Included INSIDE
padding becomes raw padding plus the newly painted side width; explicit removal subtracts the old
painted widths before accepting next latent width/alignment edits. A simultaneous NONE→Auto Layout
activation uses final applicability for addition. A simultaneous mode change with an unchanged
empty style retains special-style guards rather than clearing one sourceOnly boolean. Requested
padding is final canonical padding. Affected Grid ancestors/descendants are validated using a
capture-local current-node index with the proposed node substituted. Missing ancestry remains
unknown, never a true root. No Grid sizing guard is relaxed.

Text supports CENTER activation through the existing centered Text stroke. INSIDE/OUTSIDE asks for
a normal Center selection. The inspector exposes width/alignment/inclusion and Remove; it does not
ask users to manipulate internal metadata. Public edits use the same draft, operation-log undo and
serialization path. New-copy validation derives copying only from trusted caller options, never
from a user-controlled patch field. Raw empty-style fields participate in concurrency guards.

Meaningful controls include the actual 67-node/64-empty-style fixture, save/reopen/source no-op,
portable transfer, schema/Host validation, production native VM creation and patches, strict NONE
setter applicability, included/excluded activation/removal/width stages, unsupported style and
concurrent raw-field negatives, public compound edits and undo. CPU Chromium uses --disable-gpu;
independent CSS versus SVG/frontend activation/resize/removal comparisons require exact pixels.
A production inspector/public/undo/reopen test is added for the root's combined UI gate.

Real Figma original-versus-returned activation and all raw field getters still require the owned
native acceptance run. These CPU checks do not prove native font or stroke raster parity. The raw
152-loss baseline is not relabeled as passed. Freeform omitted inclusion is left untouched and no
universal factory getter default is claimed.

Primary contracts: [strokes](https://developers.figma.com/docs/plugins/api/properties/nodes-strokes/),
[strokeAlign](https://developers.figma.com/docs/plugins/api/properties/nodes-strokealign/),
[strokesIncludedInLayout](https://developers.figma.com/docs/plugins/api/properties/nodes-strokesincludedinlayout/).


Validation on the isolated implementation base:

- Eight affected files: 177/177 pass, Chromium forced to CPU with --disable-gpu. The first176/177 log
  remains preserved: its single legacy test expected alpha-zero sides after explicit Remove; the
  approved empty-paint transition now asserts no sides and the exact retained widths instead.
- Final model/native-VM controls after additional sourceOnly/manual-fallback hardening: 86/86 pass.
- Typecheck, repository validate, Design Studio build check, all three generated output checks and
  git diff check pass. No registered plugin files were touched.
- Inspector/public/undo/reopen integration test is added for the root combined UI gate; it is not
  executed here. Native original-versus-returned activation remains NOT_RUN.
