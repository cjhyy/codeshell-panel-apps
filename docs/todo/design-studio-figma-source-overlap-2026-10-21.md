# Figma source overlap conflicts

Independent stable-binding fix based on `1bbe0e6`; `origin/main` was fetched and
confirmed its ancestor before the task worktree was created. The later stable
`a62cea3` differs only in the ongoing-task journal and has identical package bytes.
This change does not hook native text-range admission or touch the native SDK.

A read-only reproduction supplied one official CANVAS document containing a
rectangle and a separate `nodes[id].document` for that same rectangle ID. The
second representation changed fills, style references and unknown raw paint
metadata. `createFigmaBinding` accepted the envelope; `figmaSourceNodes` retained
only the first representation, and `createFigmaPatch` planned an original-node
update with that first `before` snapshot. This demonstrates discarded planning
conflict evidence. It does not demonstrate an actual wrong native write; the
plugin still performs its live property checks.

`figmaSourceNodes(source)` keeps its existing Map API and first original raw-object
identity when representations agree. Each duplicate ID must have the same full
raw subtree: object key order is ignored, while array order, property presence,
all descendants, unknown style/paint keys, style references, plugin data and full
native-source metadata remain exact comparison data. Differences throw
`FIGMA_SOURCE_DUPLICATE_ID_CONFLICT` before a binding or patch can be returned.
No fields or descendants are stripped, normalized to defaults or selected from
one conflicting representation.

An independent root is an unknown-parent view, so an identical selected child
and its exported ancestor can coexist. Every observed non-root occurrence must
agree on parent ID and sibling position. Conflicting locations throw
`FIGMA_SOURCE_DUPLICATE_LOCATION_CONFLICT`, even if the raw node data is equal.
This also prevents first/last index order from choosing an impossible parent.

One descriptor-only pass validates complete source JSON and interns collision-free
structural tokens. Child tokens are composed bottom-up; full ancestor subtrees
are never serialized again for each layer. Only the first Map node reference is
retained. The complete envelope counts toward the exact 16 MiB JSON UTF-8 cap,
including unknown fields and repeated shared-reference occurrences. The existing
index limits remain 40 layer depth and 60,000 layer occurrences. Additional JSON
work caps are depth128, one million value visits and one million collection
entries. Cycles, accessors, hidden/symbol keys, sparse/custom arrays, nonfinite or
non-JSON values and unsupported object prototypes refuse with bounded diagnostics.
These checks do not rewrite source data. Identical acyclic shared references are
allowed, and prototype-key JSON remains inert.

`createFigmaBinding` checks raw source before its structured clone, and reopen
checks source before `normalizeFigmaSource` can serialize it. The no-accessor
promise applies to properties inside the supplied source object; arbitrary
accessors on the outer binding/function-argument object are outside this change.
No new source-envelope formats are accepted.

Controls cover actual envelope shapes with selected ancestor/child roots,
identical reordered object keys, divergent appearance and unknown/raw metadata,
deep subtree differences, array/presence changes, conflicting locations, binding
create/reopen/update/delete planning, cycles/malformed data, exact UTF-8 limits,
existing node/depth limits and a VM without browser/codec globals. Native range
metadata mutations are synthetic raw-data controls, with no SDK or pixel claim.
