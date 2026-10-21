# HTML geometry precision transport — 2026-10-21

Task branch: `codex/design-studio/html-geometry-precision-20261021`.
The topic started from freshly fetched `origin/main` (`13d591ca`) and normally
merged stable Design Studio checkpoint `80566e24`. This changes the independent
Panel repository only; it does not install or execute a Figma plugin.

## Contract and scope

The adapter now transports finite HTML measured bounds, viewport offsets,
padding, gaps and min/max dimensions without the previous two-decimal geometry
quantizer. Existing finite/range limits, source-node identity, coordinate-space
contracts and warnings remain. Canonical normalization and save/reopen retain
these numbers. Shared frontend geometry serialization also retains the supplied
finite number instead of rounding it to three decimals. There is no global
1/64 snap, coordinate offset, tolerance acceptance or cached-position bypass.

The integration captures finite `CSSUnitValue.value` only when its actual unit
is `px`, from the same real Element/semantic object held by the pinned traversal.
The tagged source box receives that capture; anonymous text and synthetic
wrappers do not acquire its padding or dimensions. Padding/gap/constraint
substitution additionally requires the unchanged original CSSOM numeric
projection, so a postprocessor's different spacing value is preserved. Percent,
mixed `calc`, keyword and unavailable Typed OM cases retain the existing path.
The DOM, input tree and authored text are not rewritten to manufacture precision.

Native browser computed values can themselves differ from authored literals:
for example, Typed OM reports `1.1234560012817383` for authored `1.123456px`.
This transport preserves the actual finite computed value; it does not claim to
recover the author's spelling. Independently authored canonical `65.59` and
measured `65.59375` remain distinct and exact.

Auto Layout frame axis-size assignments retain their finite clamped doubles.
Flex flow explicitly requests an exact subtree delta; default manual moves and
component placement keep their existing two-decimal behavior. Grid derived FLEX
track endpoints and derived Grid flow positions use an explicit Float32 endpoint
policy. Fixed/Hug authored tracks, measured dimensions and manual root positions
retain their input doubles. Implicit equal Grid columns follow the same FLEX
endpoint policy. This is a bounded numerical contract, corroborated by twenty
retained native stages / 455 boxes; it is not a guarantee for every Figma or CSS
layout. No source provenance or numerical shape selects a rounding policy.

Paint, opacity, color, stroke/radius/shadow serialization and typography policies
are unchanged. In particular, newly computed responsive Text line-box heights
and hanging-baseline y positions keep the previous two-decimal typography policy;
fixed/input Text bounds do not acquire that quantizer. This avoids interpreting
the existing four-decimal line-height ratio `1.3333` as a new precision upgrade
for a native 16px line box. Integer Grid counts and existing convergence/range
limits remain. Border-width precision and rotated-ancestor dimension inference
retain their earlier policies and are outside the new transport claim.

## Evidence and failures retained

External task evidence is under the sibling
`design-studio-html-geometry-precision-20261021/evidence/` directory; the aggregate
evidence directory retains the original source/canonical corpus and root peers.

- `early-v1`: before the px transport, actual gap `3.015625` became CSSOM string
  `3.01562px`; a three-row Hug root measured `242.8125`, while Browser layout was
  `242.78125`. The screenshots happened to be pixel-identical. Exact geometry
  assertions correctly failed. A real reflow also lost row height
  `65.59375 → 65.59` and x `30.015625 → 30.02`.
- `early-v7`: independent real CSS source and direct Browser rendering retain
  every initial frame box and strict RGBA pixels. Same-line content editing and
  a supported child-Hug long-copy growth case run real Auto Layout, save/reopen,
  and retain strict zero pixels. Pure controls exercise negative coordinates,
  thirds, min/max limits, wrap, source ownership and repeated exact fixed points.
  The later focused content-box case also checks actual min-width/min-height
  `65.59375`/`65.59` plus per-side `3.015625px` padding against source pixels.
- `early-v3` and `longcopy-baseline-v1`: a different, stretch-Fill middle wrapper
  fails to grow with a three-line edit. Both immutable `80566e24` and the topic
  reproduce **56,773** changed pixels, while the actual source root grows to
  294px. The topic retains the root at 242.8125px; the baseline Browser root was
  242.765625px. Their source screenshots are byte-identical, and each source
  before/after boundary and app/input snapshot is unchanged. This pre-existing
  Fill/Hug dependency remains unresolved; the topic does not broaden sizing.
- `affected-v1.log`: initial 58-file CPU/noGL run records 504 tests, 495 passes,
  nine failures. It preserves native Grid and Text reopen failures introduced
  by a universal double policy, plus old two-decimal assertions. Those failures
  were investigated before changing policy or expectations.
- Aggregate `native-grid-precision-policy-v1/receipt.json` (SHA-256
  `59ce387935f569de7a10cd2021d904c8e3d18f79ad49dbfcaf4876cf1cf1736f`)
  compares immutable copies: exact double had 280 native box mismatches / 36
  reopened-node changes; FLEX endpoint plus Grid position Float32 had zero / zero.
  Its source snapshot contains 130 app files, all unchanged.
- `text-fixedpoint-v1.json` preserves the Text failure: `15.9996` measured height
  moved the following baseline to `349.4096`; reopening changed its offset from
  `1.41` to `1.4104`. Restoring only the previous computed Text measurement and
  baseline policy passes the original tests unchanged.
- `table-pixel-selected-v3.log`: all five original fixed-table cases retain
  strict initial/reflow/narrow pixel counts `0/0/0`, including content edits and
  save/reopen. Canonical fractional column assertions now express the explicit
  Float32 endpoint contract; source pixel checks remain independent.

Intentional expectation changes are limited to: the validation smoke test's
computed Grid thirds; actual Cover height `50.21875` and equal-slot y
`114.890625`; fixed-table FLEX column endpoints; and the retained native vertical
Grid's old 32 horizontal differences becoming zero. Historical residual fixture
receipts remain unchanged. No source image is treated as conversion acceptance.

## Validation status

Focused geometry/source/content-box/edit controls, unchanged HTML/native Text
baseline/reopen controls, retained native Grid boxes, and independent fixed-table
pixel checks pass on the current topic. The final combined affected/static gates
and the normal merge of the latest verified stable checkpoint are recorded in
the final handoff receipt. There has been no actual Figma, native plugin, GPU or
installation run by this task. Original six-template corpus results remain strict
failures unless a separately pinned source/renderer comparison proves otherwise.
