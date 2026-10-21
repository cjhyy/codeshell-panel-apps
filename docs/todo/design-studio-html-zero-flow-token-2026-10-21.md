# Empty zero-size flow token investigation

This branch is an unhooked preparation checkpoint, not a production improvement.
The new private-proof module is not imported by any runtime and has not yet been
qualified by tests or peer review. Canonical geometry remains at minimum 1px;
no visible node, layout, source DOM or production capture behavior changes.

Baseline e40681f normally merged frozen font d87e2e4 onto fresh origin13d591c.
The real WSS source has a direct empty `pagefind-config` inline/static child at
x0/y4324.125/width0/height0. The ordinary block planner refuses zero height before
the adapter clamps it to 1px. The proposed narrow route is explicit source-only
provenance for genuinely nonpainting inline tokens between ordinary block boxes,
with private current source/Element identity, exact geometry/topology/style and
post-await rechecks. This is not a zero-size canonical model change.

External source references, synthetic source/control/difference PNGs and exact
DOM readbacks are under:
`/Users/admin/.codex/worktrees/design-studio-figma-24h-20261021/evidence/web-corpus/zero-flow-token/`.
Empty custom/span controls have zero removal difference, but shadow-only,
counter-increment and zero-font NBSP cases still measure 0×0 while removal changes
91, 86 and 25850 pixels. Those counterexamples prohibit admission by dimensions
or empty text alone. This source-domain diagnostic is not product conversion.
Its raw frozen DOM attempted external GETs, which were blocked; it must not be
confused with the production sanitized capture or the earlier enabled-live freeze.

Pending work: qualify ordinary block/no-anonymous-inline restrictions and all
negative cases; review descriptor-safe snapshot budgets; wire only branded
single-use plans preserving original source path indexes; retain explicit
source-only diagnostics and final rechecks; compare production source/converted/
diff PNGs and structural results. Counter reset/set, quote content, breaks,
containment, clear/float/position, custom-element upgrades and author CSS behavior
must remain explicit restrictions or captured-state limits. Native is NOT_RUN.

The font owner's full-suite overflow regression preempted this investigation.
This checkpoint preserves unfinished work and must not be merged as qualified.
