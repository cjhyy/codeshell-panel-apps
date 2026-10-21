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
guard can interrupt cleanup and replace the unobservable inner error. This is
explicitly reported as `guard-interrupted cleanup; owned pages may remain;
original inner SDK cause unavailable`. The exact final production message and
guard trace remain preserved. Such a run is a refusal, never factory acceptance
or proof of rollback/error equivalence. Foreign nodes are never deleted by the
probe; it records all created identities and remaining owned/foreign-page views.

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
