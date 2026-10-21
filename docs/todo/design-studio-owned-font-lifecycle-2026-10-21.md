# Owned font lifecycle · 2026-10-21

Base: fresh origin13d591c normally integrated ca408735 (Browser29bc + PRD570),
then root's test-only reentrancy fixture successor04ddd09. Browser task worktree
and its dependency link remain frozen and untouched.

The read-only audit's original files remain under
`design-studio-document-font-ownership-20261021/evidence`, handoff SHA
92bffeb4f477ec826879a206bb41e5daf7e725daad40e2ad4072d06fb7372cc6.
It proved real browser font contamination with an independent foreign face
retained, and preserved the working old-workspace stale guard.

Implemented exact-instance staging/commit/rollback leases, content-aware reuse,
empty/reset release, loaded-page reconciliation and page lifecycle cancellation.
The app gates resource preparation before renderer/save use, retains rollback
state and source scope checks, and restores exact prior faces after guarded
failed open/import/create. Persisted synthetic hide/show is recoverable through
font reacquisition plus selected-controller resume; nonpersisted unload stays
disposed. Full lifecycle contract is in ../design-studio-owned-fonts.md.

First focused run13/13 PASS486.453ms, including real --disable-gpu Chromium
FontFace/Canvas2D: staging does not publish A, invalid candidate never poisons A,
same ID with changed actual Inter/Roboto bytes replaces the face, lease rollback
restores the precise old instance, empty/reset/suspend returns to captured serif
baseline, and the independent face remains. Four old reentrancy VM controls pass.
Broader affected90/90 PASS27895.112ms includes the complete recovery UI and
recovery-session/portable/legacy/font-resource suites, using an external preload
that records every effective Chromium launch with --disable-gpu.

The first broad invocation omitted the explicit CPU flag on the existing
recovery helper. It was stopped through its captured session and is not CPU/GPU
acceptance; the incomplete affected-v1.log is retained. The subsequent explicit
CPU run is affected-v2-cpu.log. No source launcher was weakened or globally
reconfigured. No native Figma, Host install, GPU or real BFCache run by this owner.

Actual app-specific fault replay, independent peer and final static pins are
pending this first candidate freeze; this note makes no final pass claim.

## Preserved v1 findings and successor

Frozen43394cde116b72089af2c5ebfa3a2920f6518acb passed root full main898
(897pass/1skip), but full UI113 retained111pass/1fail/1skip. The original
unsaved imported-source recovery test expected Imported product and received
A original: the new final font load still used the disk baseline resource
registry after recovery operations had restored different descriptors. The
successor rebuilds the validated scoped cache from the normalized replayed
resources, then loads them; all original assertions remain, with an added real
decoded-font registration/selection proof before and after recovery. The exact
original test and expanded proof both pass under explicit CPU/no-GL scheduling.
Root's full UI failure receipt66722e13a077fc64aaf91ad70f34a69f3bff09b5cc67b63fbe7cd646473ca709
remains preserved.433 is not final approval.

Root also identified effective FontFaceSet order despite ordered preparation.
Real Inter+Roboto same-family resources gave595.046875px for A,B and erroneously
the same for reused B,A; independently reset/fresh B,A gives591.125px. Original
source images and numeric failure are retained in face-order-v1 evidence. The
successor installs only owned instances in the requested order and restores the
old order on rollback; it also refuses a reordered reference set during await.
The real current regression reuses the same decoded instances and matches fresh
reverse width and strict RGBA0; forward versus fresh differs7871 pixels, so this
control distinguishes the actual font selections.

Successor18/18 focused PASS507.156ms and95/95 affected PASS27177.210ms,
including four actual production-loader scheduling controls and unchanged
recovery/resource/editor guards. CPU preload also refuses any WebGL context in
the targeted original exchange test; no GPU pixels are inferred from it.

On frozen433, an actual app/Host-stub synthetic lifecycle probe completed16
states without page errors: three hide/show repetitions, actual Browser selection
and text editing after recovery, pending font release after hide, delayed show
preparation interrupted by document/workspace/re-hide, final show recovery, and
nonpersisted unload remaining disposed. Diagnostic1100×100 public-font images
after the three shows/final show are strict0 versus initial; hide is8302px/max255,
confirming actual release. These are synthetic event and diagnostic-font proofs;
real BFCache, Host and whole-product/Figma pixel acceptance remain NOT_RUN.

The v1 freeze's134 pins comprise130 app/ files plus4 tests/catalog;137 is the
complete Design Studio package count. Earlier messages conflated these counts;
the original JSON correctly records130 and is retained. The successor freeze
will explicitly pin the entire package and tests, separately counting app files.
