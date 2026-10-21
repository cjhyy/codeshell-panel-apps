# Native text-range source codec

Pure source evidence and canonical intent codec, based on native-boundary commit
`7e9ec1ac0b6e7e0fac3ba4542c533d5dba31ae50`. This change does not install an SDK
extractor, activate the bridge importer, change the schema, or enable native
create/patch. The existing all-ranges native refusal remains in force.

`app/native-text-ranges-source.mjs` exports:

- `buildNativeTextRangeSource({rest,characters,scalars,segments,rangeChecks=[]})`
  returns `{status,source?,diagnostics}`. It binds complete live observations to
  the known REST text projection without modifying official fields.
- `validateNativeTextRangeSource(rest,candidate=rest.codeshellNativeTextRanges)`
  returns `bound`, `absent`, `invalid`, or `stale`; invalid raw remains the caller's
  preserved source, never a repaired active hint.
- `importNativeTextRanges({rest,source,canonicalNode})` returns `admitted-intent`,
  `uniform`, or `unsupported`, optional `textRanges`, diagnostics, and always
  `pixelsVerified:false`. It validates the whole candidate with the existing core.
  Native uniform text matching the scalar style stays `uniform` without ranges;
  source decoding alone must not subject ordinary Text to the staged range guard.
- `nativeTextRangeSnapshot(source)` returns stable source comparison JSON. It
  includes live units, presence and unknown observations, excluding ephemeral
  REST override IDs. It is comparison data, not a native patch authorization.

The proposed raw TEXT field is `codeshellNativeTextRanges`:

```js
{
  version: 1, nodeId, characters, restSignature,
  scalars: { [field]: observation },
  segments: [{ start, end, characters, values: { [field]: observation } }],
  rangeChecks: [{ start, end, values: { [field]: observation } }]
}
```

An observation is exactly `{kind:'value',value:<JSON>}`, `{kind:'mixed'}`,
`{kind:'missing'}`, or `{kind:'error',message}`. A producer must compare the actual
`figma.mixed` identity before serializing; strings such as `FIGMA_MIXED` are not
magic production sentinels. Missing, null, numeric1, AUTO and exact Float32 values
remain distinct. Scalars and segment properties have separately exported field
lists; scalar-only properties must not enter a getStyledTextSegments call.

Caps are4000 UTF16 units,256 segments/checks,256KiB UTF8 and depth12. Core range
caps stay64/32KiB. Any overflow or unsupported whole-node condition refuses
admission without truncation. The producer still owns the total16MiB source cap.

Supported intent requires uniform supported font metrics, source text, no lists,
indent/paragraph spacing, custom shaping, bound variables, missing-font ambiguity,
truncation or nondefault wrapping. Plain color is one opaque visible normal SOLID.
Each native channel must exactly equal `n/255` or `Math.fround(n/255)` for an
integer0..255. A nonrepresentable color is retained raw and refused with a
quantization diagnostic; there is no epsilon, rounding, first-paint or alpha
approximation. Links preserve literal safe absolute URL/mailto/tel; native NODE,
unknown and fragment targets including literal `#` refuse admission.

Native underline style/offset/thickness/color/skipInk observations cannot be
relabelled CSS px/em. Any non-null native custom decoration refuses the entire
range candidate, preserving paint/link and geometry in raw source rather than
emitting partial ranges and declaring success. Even basic recovered decoration
intent has no cross-renderer pixel claim. SDK numeric1 hyperlink results remain
unknown; complete valid styled-segment evidence can independently establish a
link or no-link, with the anomalous getter retained and diagnosed. Conflicting
valid REST/segment/getter values reject capture. Stored pluginData is never read.

The compact actual fixture projects the final returned live and official TEXT
objects from630cc296, preserving exact numbers and presence and excluding PNGs.
Original JSON SHA:
`f32087334eb38b0b2ecebb09fc32af6f92730363e51bcac07d4e140c3828973c`.
All six sources bind and survive JSON reopen; all six correctly refuse custom
native decoration admission. This is source-codec validation, not a new native
or HTML pixel acceptance. Independent original-PNG replay remains external under
`evidence/native-text-ranges-sdk/peer-630cc296-pixel-replay/`.

Primary API references checked:

- [getStyledTextSegments](https://developers.figma.com/docs/plugins/api/properties/TextNode-getstyledtextsegments/)
- [StyledTextSegment](https://developers.figma.com/docs/plugins/api/StyledTextSegment/)
- [TextNode](https://developers.figma.com/docs/plugins/api/TextNode/)
- [REST node types](https://developers.figma.com/docs/rest-api/file-node-types/)
- [textWrapStyle](https://developers.figma.com/docs/plugins/api/properties/TextNode-textwrapstyle/)
