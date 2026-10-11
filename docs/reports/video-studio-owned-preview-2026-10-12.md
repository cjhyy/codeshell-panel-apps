# Free move/trim owned preview design and prototype

The prototype changes application modules only in esbuild's memory. Run:

```sh
node scripts/video-studio-owned-preview-prototype.mjs
node scripts/video-studio-owned-preview-prototype.mjs --structured-clone
node scripts/video-studio-owned-preview-prototype.mjs --unfrozen-base --structured-clone
```

Chromium, 3 warmups and 12 measured candidates, legal 5000 media clips across
2000/2000/1000-clip sequences. Times are local observations rather than thresholds.
CDP forces GC before measuring three retained capabilities and after disposing them.

| 5000 clips | Current public call | Frozen base + private clone |
| --- | ---: | ---: |
| Move candidate | 42.27ms, 2 validations | 25.13ms, 1 final validation |
| Trim candidate | 63.78ms, 3 validations | 25.05ms, 1 final validation |
| Prepare move once | — | 24.33ms, 1 full validation |
| Prepare trim once | — | 30.28ms, 1 full validation |
| Detached full-document read | — | 3.67ms |
| Move retained heap | — | 1.90MB |
| Trim retained heap | — | 2.80MB |

Frozen base + structuredClone instead took 34.49/35.70ms per move/trim candidate,
23.92/37.63ms preparation and 1.90/3.02MB retained heap. An unfrozen base with
structuredClone took 35.19/35.23ms per candidate, 20.67/34.68ms preparation and
1.91/3.02MB heap. The private copy is an ordinary recursive Object.keys/Array.map
copy used exclusively for the validated private graph. It preserves -0, key order,
null, booleans, Unicode and empty arrays; undefined is rejected by the factory's
validator. JSON.stringify/parse is unsuitable because it changes -0.

Dispose returned retained heap to within 20KB of the baseline. A trim capability
owns the complete graph for validation plus a frozen copy of the selected sequence
for geometry. Only one capability is required by a gesture.

## Proposed interfaces and shared core

```ts
// operations.ts
prepareEditorOperationPreview(value: EditorDocument): {
  read(): EditorDocument;
  preview(operations: readonly EditorOperation[]): EditorDocument;
  dispose(): void;
};

// clip-edits.ts
prepareClipTrim(value: EditorDocument, sequenceId: string, clipId: string): {
  plan(localStart: Tick, localEnd: Tick): EditorOperation[];
  dispose(): void;
};
```

`operations.ts` extracts a private `applyOperationsToDraft(before, next, ops, rev)`
containing the existing operation checks, mutation, caption reconciliation and
complete final graph validation. Public `applyEditorOperations` still fully
validates and copies its caller document before calling that core. The capability
fully validates once, deeply freezes its detached base, and privately clones that
base for every candidate. No unchecked document, callback, token or marker enters
the core through a public parameter. Read and preview results are detached.

`clip-edits.ts` extracts only the existing trim geometry/binding logic into private
`trimOperations`. Public trim retains its context validation and finish checks,
including the existing empty-operation early return. `prepareClipTrim` creates its
own operation capability, freezes a detached selected sequence, builds the same
trim operations, validates them through the capability, and returns copied ops.

The base is never modified or replaced by a candidate. Dispose clears the base and
geometry; later calls reject. A getter may reenter preview while an operation's
nested value is cloned; drafts remain independent. A reentrant dispose rejects the
in-flight result as well. A strict directive on the private mutation core exposes
accidental writes in that function. Helpers also require their own strict mode or
explicit immutability tests; strict calling code does not change a helper's mode.

## Dangerous mutable-object cases checked

1. Caller freezes only the document's root, then changes a nested track lock and
   removes the asset list. The captured base is unaffected; public apply still
   rejects the now-malformed caller document. Accessor documents are rejected
   without invoking their getters.
2. Caller mutates `read()`, a preview result, operation arrays, nested time maps or
   a returned trim patch. The next candidate still starts from the original base.
   An intentional deep write to `before` inside the strict mutation core throws.
3. An operation's nested getter reenters preview, modifies its result, or disposes
   the capability. Reentrant results cannot poison the outer draft or base; dispose
   prevents publishing that result and rejects further calls.

The prototype also compares public/owned caption movement, provenance reconciliation
and word slicing; rejects locked tracks, collisions and source overflow; and rejects
a trim invalidating another sequence's source range. Ten groups of checks pass.

## Timeline ownership and lifetime

Prepare lazily on the first actual free move/trim candidate after the drag threshold.
Pure clicks, seeking, marquee and magnetic planning do not create a capability.
Keep the existing candidate key: kind, quantized delta and destination track. The
gesture captures document id, revision, session generation and sequence id. Any
identity/sequence change cancels and releases it, including same-id/revision reopen.
Alt and autoscroll recompute the candidate key with the current coordinates.

Pointerup synchronously flushes pending coordinates and Alt, checks identity, and
captures detached validated operations before cancel releases the capability. A
same-key result can be reused; final `context.apply` / session dispatch still uses
the public complete transaction validator. No preview document goes directly into
history or persistence. Escape, pointercancel, lost capture, zero-button moves,
window blur, hidden document and view disposal all use the same release path.

With unchanged final commit costs excluded, the 5000-clip move preparation pays
back after 2 distinct candidates; trim pays back on its first candidate. Ten
candidates cost approximately 423→276ms for move and 638→281ms for trim. A one-step
move costs approximately 42→49ms, so lazy creation avoids adding cost to clicks but
does not promise faster isolated one-step drags. Full final validation still costs
roughly 21ms: this improves long gestures without promising 60fps on a 5000-clip graph.
