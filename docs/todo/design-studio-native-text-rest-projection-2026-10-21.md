# Native text REST binding projections

Actual SDK field-matrix run `1ed86d39` captured all requested fields for four
Text nodes, while the original source codec rejected all four as a capture
race. The frozen fixture retains every original case object, including those
failed build results, under
`tests/fixtures/design-studio/native-text-field-matrix-1ed86d39.json`.
Its provenance identifies the complete original result by SHA-256
`6c59ea3aaa84a46546c0dac30d7ebe4cbe5021509d1c470970f1ff4ff72f9c8c`.
This was actual SDK research with no production converter or pixel parity claim.

Two comparison bugs caused the false binding failures:

- A requested percentage of 120 was observed by the SDK as
  `120.00000476837158` and by REST as `120.00000762939453`.
  The fractional control observed `131.57999515533447` in the SDK and
  `131.5800018310547` in REST. In both cases the REST value equals exactly
  `Math.fround(liveValue)`. The binding comparator now accepts only the exact
  live value or this exact Float32 projection for a matching PERCENT unit.
  No epsilon, decimal rounding, pixel-unit projection or raw-value rewrite is
  applied. The full snapshot still distinguishes different live observations
  that project to the same REST value.
- For `A😀 linked\nend`, REST override indices count the emoji once, whereas
  SDK segment boundaries use UTF16 offsets. The REST override begins at
  character index 3; the corresponding SDK segment begins at UTF16 offset 4.
  Binding now uses one Unicode scalar index while walking validated UTF16
  segments. It never tries multiple interpretations to find a match.
  Missing trailing REST entries still mean default style 0.

The [REST node documentation](https://developers.figma.com/docs/rest-api/file-node-types/)
describes per-character overrides and omitted trailing default entries; the
scalar-versus-UTF16 distinction above is established by the frozen SDK/REST
pair. Synthetic controls separately style each scalar in a sequence containing
two emoji, a combining mark, NBSP and an authored LF. Wrong UTF16-indexed
override arrays and shifted styles are rejected.

All four corrected sources bind with their captured scalar, segment and range
getter observations unchanged. Missing scalar `fontStyle`, `listOptions`,
`indentation` and `textStyleOverrides` remain explicit missing observations;
complete segment values do not invent scalar defaults. Numeric hyperlink
getter 1 remains unknown raw evidence.

Canonical metric admission is unchanged. The requested canonical ratios 1.2
and 1.3158 still disagree with the exact native values and remain explicitly
unsupported. No author metric is replaced with an observed value to claim
success. The native gapped cases also extend their final styled segment to
UTF16 offset 11, including the authored LF, despite the research setter's
requested end offset 10. This native result is retained exactly and does not
prove equivalence to a shorter author range. Complete gap-writer behavior
requires separate native evidence.

This change adds no capture/runtime hooks, SDK writes, metadata authority or
native range admission. It corrects source binding only. Genuine font, unit,
line-height, spacing, alignment and style contradictions continue to refuse
the complete source; rejected inputs retain their original raw observations.
