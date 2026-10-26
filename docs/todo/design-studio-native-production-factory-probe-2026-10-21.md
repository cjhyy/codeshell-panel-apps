# Whole production Text factory probe preparation

PREPARED ONLY. Actual Figma execution is NOT_RUN. No plugin installation, relay,
CUA, GPU, original-design writes or native pixel acceptance occurred here.
The existing v4 complete-writer and HUG-negative-gap runners remain unchanged.

This independent research branch starts at exact candidate
`1ad67f02586d978675f56c3f364e6b5787a20b64`, after fetching origin and confirming
that current origin/main is its ancestor. Its product bytes stay frozen while
the main native candidate continues independently. The source worktree must be
retained because the frozen observer records reference its unchanged app files.

The probe embeds the complete production `figma-plugin/code.js` unchanged inside
a static `(figma,__html__)` function. Its SHA-256 is
`b461603f5125a9e8704d5d70badeb5e95b43df3924c890ce10ff8d9b2e399be2`,186128bytes.
All four generated runtime slots were independently rebuilt byte-exact with
esbuild0.28.2 and25 unique source-file digests. The production closure proof SHA
is `0378f2e7c8805799eacb175dabdd987496af1444699110fb5cd8026f2e337f24`.
Creation, range setters, final sizing, finalizer metadata and rollback execute
the production code; none is reimplemented by the probe.

A narrow API facade suppresses only the production startup `showUI`, captures
its private UI handler and exact imported/error messages, and dispatches one
fixed `import-transfer` message. Actual SDK node objects retain identity and are
never wrapped. Allowed mutation APIs are page/frame/Text creation, the fixed
Inter Regular font load, owned-page navigation and one owned-frame viewport call.
Creation order and the total ten-node limit are independently checked. Arbitrary
lookups, undo, other creation APIs and additional UI messages are denied.

The production `assertOwned` reads `figma.root` after successful awaited Text
exports. The facade uses that read only for deadline/known-current-page checks;
the production ancestry and subtree checks retain authority. First refusal
latches cleanup-only mode. Later root reads return the real root, creation/font
calls stay denied, and returning from an owned page to the original remains
allowed. No success is accepted after any guard event.

One combined failure has a deliberate limit: if an earlier native error enters
rollback and the first deadline refusal occurs inside `removableOwnedPage`, the
guard can interrupt cleanup and replace the unobservable inner error. The exact
final production message and guard trace remain preserved. Such a run is a
refusal, never factory acceptance or proof of rollback/error equivalence.
Foreign nodes are never deleted by the probe; it records all created identities
and remaining owned/foreign-page views.

The fixed data has one vertical Auto Layout frame with eight Text cases:
Unicode/ASCII gapped paint+link, full blue with unused black author base, explicit
same-color/NONE ranges, PERCENT120/100/131.58 and PIXELS24/25. It is created through
the pinned offline transfer builder. The actual production factory performs all
native setters. Post-success observation preserves official REST, complete native
source, raw unknown getter observations, final sizing and actual saved author
hints. Restore checks use a separate read-only observer from the same candidate.
An observation/hint refusal retains its complete captured case. Original-page
full REST, selected-node REST and selection IDs must match before/after return.
Native PNG is intentionally deferred until this first source/hint probe succeeds;
production UI, bridge conversion/roundtrip and pixel parity remain outside scope.

The runner uses the existing helper and exact original three plugin-file hashes,
and the pinned guard remains page68:1634/selection68:1635 with its historical
receipt. The current desktop context is stale; no guard was repinned. The new
runner's complete `main` lifecycle/relay/installation tail is byte-identical to
reviewed v4. The only executed CLI mode was `--prepare-only`, which returned
`PREPARED_UNARMED` before creating a service or acquiring installation locks.
Original registered plugin bytes and both absent locks were verified afterward.

Frozen artifacts live under the primary checkout's ignored
`artifacts/design-studio-figma-plugin/`, using the prefix
`native-text-production-factory-v1` and new runner
`native-text-production-factory-24h-research-v1.mjs`. They include full production
bytes, observer, fixed data, basis, complete closure proof, program, permissive
mock and tests. The unchanged registered development plugin is a separate folder.

The external evidence directory is
`/Users/admin/.codex/worktrees/design-studio-figma-24h-20261021/evidence/native-text-ranges-sdk/production-factory-preparation-v1/`.
Its preparation receipt SHA is
`de0b59c7d43fd81f29604da141bba88c39dfc3bd2d4164c6db0529a86b1351f2`.
The21 VM checks pass,1350.175834ms. They cover full-code/lifecycle pins, exact
identities and source/hint recovery, wrong guard/nonce, deadline and foreign-page
await races, moved nodes, foreign insertions, creation limits, denied APIs,
native/hint/remove failures, guard-interrupted cleanup, persistent LF inheritance,
late stale hints and receiver tampering. Mock logs show no native metadata/layout
writes after a scope refusal. These are synthetic host checks; their source/size
values and successful setter behavior are not actual Figma results.

Independent review found a reporting overclaim in preserved v1: it classified
every guard refusal with retained pages as interrupted cleanup with an
unavailable inner SDK cause. A successful native export followed by external
child insertion and deadline expiry can instead finish production's foreign-safe
retention normally. Neither an earlier SDK failure nor interrupted cleanup is
established by those broad observations. This is a reporting issue; the run was
still refused and the foreign node remained intact.

The first prepared successor uses `native-text-production-factory-v2.program.js`,
`.mock.js`, `.test.mjs` and `native-text-production-factory-24h-research-v2.mjs`.
It shares the exact immutable v1 production code, data, observer, basis and
closure proof. All ten v1 artifacts and their evidence remain unchanged.
The v2 program reports the generic classification `guard refusal with retained
owned pages; cleanup completeness and inner cause not established`. It does not
infer the earlier SDK cause or completeness of cleanup. The known combined
failure above remains a distinct documented limitation.

The22 v2 CPU VM checks pass,1340.520625ms, including successful export followed
by foreign insertion plus expiry. Both that case and the earlier-error case
retain exact final production messages and refuse acceptance. The `accepted`
flag covers complete source/hint proof and original full-REST/selection return.
Final native dimensions and FILL/HUG/Auto Layout readbacks are recorded for
review; real native layout parity is not asserted by this flag. Expected mock
layout values in CPU tests do not establish actual Figma behavior.

The v2 evidence directory is the adjacent
`production-factory-preparation-v2/`, with preparation receipt SHA
`3ba2ab992d3b36d85fc92e5135390ac6c21579cc067e4975e028844253491ce2`.
Its three full synthetic examples distinguish successful source/hint proof,
the known combined cleanup failure and successful-export foreign retention.
The only v2 CLI mode executed was also `--prepare-only`; its state remains
`PREPARED_UNARMED`, with no relay, endpoint or installation lock. Registered
plugin bytes and old v4/HUG artifacts remained unchanged.

Further independent review reproduced a stale observation race in preserved v2.
After a successful second observed Text export, the first Text's hyperlink getter
could change from1 to2. Earlier source/hint proof stayed verified and the v2 run
incorrectly remained accepted. The exact synthetic misleading-success result is
preserved in `production-factory-preparation-peer-v2/`; it is not a native result.

The current prepared successor is v3: `native-text-production-factory-v3.program.js`,
`.test.mjs` and `native-text-production-factory-24h-research-v3.mjs`, sharing the
unchanged v2 mock and exact v1 production/data/observer/basis/closure. After the
last awaited original-page/selected-node REST return operation, one final
synchronous phase checks all eight Text objects immediately before acceptance
and result serialization. There are no further awaits, exports, SDK writes,
hint repairs or patches. The existing creation/current-page/root facade is
unchanged; only this read-only final observation phase allows the original page.

That phase checks exact owned page/frame/Text references, order, IDs, characters
and actual ancestry. It recaptures the complete SDK catalog against each Text's
previous own REST, compares its exact raw snapshot and saved hint bytes, and
independently restores the fixed authored intent again. A mismatch retains both
the original and final raw observations with case-specific refusal diagnostics.
If a Text left exact owned ancestry, its identity/parent refusal is retained and
source capture is skipped outside that ancestry. The receiver requires all eight
final proofs and their mappings/snapshots/hints/restoration to match.

The29 v3 CPU VM checks pass,2767.949625ms. They additionally reproduce first-Text
getter changes during a later Text export, created-page export, original-page
return export and final selected-node return export. All four now refuse and
preserve the original getter1 and final getter2 observations. Late hint-byte,
character and ancestry changes also refuse without repair. An initial run's
seven new controls failed before production creation because the synthetic
wrapper dropped the mock `createText` receiver; fixing that mock-only binding
made the actual race controls execute. Production code and guards stayed pinned.

Final synchronous capture establishes current exposed SDK observations anchored
to each previous own REST. It cannot establish fresh unknown REST-only values
without another awaited export. The original full-REST/selected-REST return
proofs are sequential observations, not an atomic whole-document snapshot.
Native layout dimensions remain recorded observations and real pixel parity
remains NOT_RUN.

The v3 evidence directory is `production-factory-preparation-v3/`, with receipt
SHA `f9f4d8452962e61c3be32aa97547d930f0f0d9d7f3315ab291afc28afe7dcd81`.
It preserves four complete synthetic results, including both getter-race edges
and a final hint mutation. Its only CLI invocation used `--prepare-only` and
returned `PREPARED_UNARMED`; no service, endpoint, lock or installation was
started. All v1/v2 artifacts, old v4/HUG runners and registered plugin bytes
remain unchanged.
