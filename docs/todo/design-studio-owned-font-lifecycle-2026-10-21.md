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
