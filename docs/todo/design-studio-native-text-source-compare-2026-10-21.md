# Native text-source comparison

Staged pure conflict evidence based on `4f0d136`. This helper does not capture
SDK values, write nodes, activate source export/import, change runtime guards,
or establish pixel parity.

`app/native-text-range-compare.mjs` exports
`compareNativeTextRangeSources({expectedRest,currentRest})`. Both inputs must be
identified official TEXT nodes with their own `codeshellNativeTextRanges` field.
The result contains `status`, at most two bounded constant-message diagnostics,
and exact UTF-8 `bytes:{expected,current,total}` after both owned clones succeed.
Statuses are:

- `unchanged`: complete native snapshots and resolved REST text styles agree.
- `changed`: raw native observations/boundaries or REST text styles changed.
- `snapshot-required`: historical metadata is absent or lacks the complete
  reviewed observation catalog. Recapture is required before original-text work.
- `stale`: a source signature is stale for its own REST node.
- `invalid`: malformed, oversized, conflicting or incomplete current evidence.

Historical source validates against historical REST; fresh source validates
against fresh REST. The helper never validates the old signature against the new
REST object. Complete evidence requires every reviewed scalar and segment field,
and all seven decoration/link getter observations for each matching segment.
An explicit `{kind:'missing'}` is retained evidence; an omitted catalog key is
incomplete evidence.

The exact `nativeTextRangeSnapshot` retains unknown getter numeric1, missing,
mixed, null, errors, raw Float32 values, units, custom decoration and SDK UTF16
segment/getter boundaries. Same-value segment splitting conservatively conflicts.
The comparison does not coalesce or repair that historical native evidence.

REST projection separately resolves character overrides in Unicode scalar order.
Override0 and omitted trailing entries use the base style. Base style and fills
remain presence-aware, including unknown nested keys. Effective overrides merge
with base style; only exact inherited properties can disappear from a delta.
Equivalent override ID renumbering and trailing zero expansion compare equal.
Referenced effective styles are interned, so a large base is not duplicated for
every scalar. Unused table entries remain a sorted multiset of raw styles with
only ephemeral IDs removed. Unknown paint metadata, top-level `styles`,
`textStyleId` and `fillStyleId`, and text-context properties remain comparison
data. Malformed unused table entries refuse rather than disappear. This helper
does not compare node names or geometry; the existing general source preflight
must continue checking those fields independently.

Each complete input node, including metadata and unrelated fields, is cloned
through own enumerable data descriptors with an exact 256 KiB JSON UTF-8 cap,
4000 UTF16 character cap, depth16 and bounded collection/step counts. Accessors,
holes, symbols, cycles, unsupported prototypes and non-JSON values refuse without
executing getters. Prototype-key JSON remains inert owned data. A pair is at most
512 KiB; the producer/caller still owns the complete-transfer 16 MiB cap and
duplicate-node identity checks. No DOM, URL, TextEncoder or structuredClone is
required by the helper.

Focused controls include all four unchanged actual `1ed86d39` captures, override
renumbering/trailing defaults, unknown base/used/unused styles, unknown paint
metadata and style references, own-source stale checks, full catalogs, getter
numeric1/null/missing/mixed/errors, custom underline geometry, distinct raw
percentages within one Float32 REST bucket, exact same-value SDK segment splits,
malformed unused styles, accessors and exact UTF-8 budget boundaries. The original
actual fixture is unchanged; synthetic mutations are explicitly controls, not new
native execution. The native-like VM runs without browser or modern codec globals.
