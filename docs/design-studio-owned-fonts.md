# Document resource font ownership

The app owns exact `FontFace` instances for the currently materialized document
resources. A document with no referenced fonts must not continue using the
previous document's resource faces. An unsuccessful open/import must not publish
a partially decoded font set or change the restored document's font environment.

`app/owned-fonts.mjs` provides a private transaction manager. `begin(check)` binds
an operation to the current lifecycle and preparation revision. `prepare` awaits
every real decoder without adding any candidate to the shared FontFaceSet.
`commit` synchronously replaces the complete owned set. Resource reuse requires
the same ID, content URL, SHA, size, MIME, literal family, weight and style; an ID
alone is insufficient. Decoder completion order does not reorder the prepared
resource map. The inputs come from the existing validated DesignResourceCache;
this manager does not provide a new resource admission boundary.

The committed FontFaceSet must also follow that order. For colliding literal
family/weight/style faces, retaining their previous insertion order changes CSS
font selection. A changed target removes only installed owned instances and
readds the decoded target instances in Map order; failure restores the exact
previous instances in their previous order. The fast path requires the same
ordered instances and confirmed membership. A real Inter/Roboto reversal is
compared with an independently reset/fresh reverse order, including exact RGBA.

A branded `captureLease` retains the exact previous instances. `restoreLease`
invalidates outstanding preparation and reinstalls that set, removing only new
owned instances. The app retains its workspace/document/state/publication checks
before rollback. Workspace reset and pagehide invalidate old leases as well as
pending work, so rollback cannot reinstall a previous lifecycle's faces. A native
FontFaceSet mutation error attempts exact-instance rollback and reports any
cleanup errors together. Other callers' faces are never enumerated for deletion;
there is no FontFaceSet `clear` or family-based removal.

The former eight ID-only clear sites now have distinct roles:

| Boundary | Font transaction |
| --- | --- |
| Open | Keep old set during preparation; commit complete next set or restore guarded backup |
| Clean external reload | Same guarded preparation/backup behavior |
| Import replacement | Prepare before render/save; restore existing import lease on permitted rollback |
| Import rollback | Restore exact previous instances alongside canonical state/URLs |
| New document | Clear owned set; keep prior lease available to the enclosing save transaction |
| Workspace change | Release owned set and invalidate all old leases/work |
| Recovery replacement | Prepare baseline and then reconcile the replayed/current resources before rendering |
| Reset to blank | Clear owned set |

Loaded-page hydration includes the complete currently materialized page set.
Compaction reconciles its retained references and releases faces no longer used.
The app preserves the complete named fallback-family resource selection contract.
Scope checks run at each asynchronous edge; the final source-reference and
descriptor checks occur before preparation and commit without rescanning every
node for each resource decoder. Resource URLs are published only after complete
font preparation succeeds. Renderers remain suspended while the new document's
font resources are not ready.

Final reference validation includes ID order. Recovery operations may replace
the baseline resource metadata entirely; the replayed normalized descriptors
therefore get a new validated workspace-scoped cache before final preparation.
Reusing the baseline cache for newly recovered resources is invalid.

Pagehide immediately invalidates pending font work and releases the app-owned
public faces. For a persisted event it suspends both renderer controllers; for
an ordinary unload it retains their existing dispose behavior. A persisted
pageshow reacquires the current document fonts, then resumes only the selected
renderer if workspace, document and page lifecycle still match. Repeated hide,
workspace/document replacement or a later preparation cancels the old work.
An ordinary unload cannot be revived by a synthetic persisted pageshow.

The manager and app preserve canonical resource descriptors, literal family
names, resource bytes, fontRef and saved designs. Browser renderer private alias
faces and any independently registered public face have separate ownership.

Validation is recorded in the task journal and external receipts. The original
CPU app audit retains the 8,302-pixel A→empty-B contamination and 7,772-pixel failed
B rollback failure. Those are diagnostic browser-font images, not CanvasKit or
Figma screenshots. New tests use real CPU Chromium FontFace decoding and
Canvas2D measurements, plus isolated fault controls. Synthetic pagehide/pageshow
does not establish real BFCache, installed Host or operating-system page recovery.
Native Figma, GPU and whole-product pixel qualification are separate boundaries.
