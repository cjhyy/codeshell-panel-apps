# Exact canonical native PERCENT transport

This candidate follows `cacc9c1` and changes only the pure source codec's
canonical line-height corroboration, its tests, documentation and the existing
generated native text runtime. It adds no capture, export, patch, writer or
primary activation. Complete production-writer v4 acceptance remains NOT_RUN;
this metric result is neither CSS/native pixel parity nor a full-writer result.

The retained actual `1ed86d39` result is SHA-256
`6c59ea3aaa84a46546c0dac30d7ebe4cbe5021509d1c470970f1ff4ff72f9c8c`.
Its four unchanged cases include plain uniform Text, gapped paint/link Text,
full-range paint and a fractional line height. Three request PERCENT120 and
observe SDK120.00000476837158; the fractional case requests131.58 and observes
SDK131.57999515533447. These independent setter/getter observations support a
metric transport fix without claiming that the complete range writer is proven.
The earlier unimplemented proposal's decision to defer all work until v4 is
superseded for this narrowly scoped metric fix; its preserved observations,
arithmetic controls and complete-writer limitations are unchanged.

After the existing bounded owned clone and canonical validation, the codec uses
the production `nativeTextLineHeight(canonical)` helper. Units must agree and
the observed value must be a finite number. Admission requires exact equality
with the requested value, or PERCENT-only equality with:

```js
Math.fround(requested.value / 100) * 100
```

This is the SDK's Float32-ratio representation, distinct from REST's subsequent
`Math.fround(live.value)` percentage serialization. The fractional observation
distinguishes ratio-first transport from rounding the percentage first. The old
synthetic `Math.fround(131.58)` getter remains refused. PIXELS stays exact;
equivalent physical heights cannot exchange units. Unknown/null canonical units,
strings, nonfinite numbers and values outside the model envelope refuse.

No epsilon, rounding search, nearest decimal, alternate unit or REST-derived
canonical scalar is tried. The existing bridge can round a high-precision native
ratio into a different four-decimal bucket; that remains a refusal. Different
canonical ratios can also share one native bucket, so the predicate cannot prove
which ratio was authored. Author hints still contain and restore only fill/range
intent, never font or line-height metrics.

Raw uniform native metrics, units, missing/error/mixed observations, unknown
getter1, source signatures, REST signatures and SDK segment boundaries remain
exact. The four actual raw snapshot hashes are pinned in the tests. The linked
LF extension stays at SDK UTF16[4,11), even though the research setter requested
[4,10). Nothing trims that LF or treats the mismatch as creator equivalence.
The four sources now produce one `uniform` and three `admitted-intent` results,
all with `pixelsVerified:false`.

Controls cover exact legacy values, adjacent Double values on both sides,
percentage-first and generic Float32 mistakes, strict PIXELS, unit/envelope
failures, canonical bucket mismatch, unchanged hint fields, mixed direct/transport
native metrics and exact raw snapshot conflicts. Existing font axes, font
family/size/weight/style, alignment, spacing, shaping, decoration and unsafe-link
guards remain separate and unchanged. The portable source test still executes
without DOM, TextEncoder, URL or structuredClone.
