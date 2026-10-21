# Saved prototype parity for the offline CLI

This task starts from freshly fetched origin/main13d591c and normally integrates
the tested Design Studio checkpoint39a14ab. It changes the package-local CLI,
its scoped documentation and meaningful installed-package tests. It does not
change the live editor, canonical/prototype schemas, native Figma code, IDs,
sidecar authoring/CAS operations or Host capabilities.

The frozen source audit80566e2 demonstrated a real workflow gap: CLI frontend
cannot export the existing multi-page prototype, and replacing a design node ID
while retaining requirement notes leaves a dangling prototype link that old
CLI validation reports as valid. Its immutable evidence remains external at
`/Users/admin/.codex/worktrees/design-studio-prd-prototype-navigation-20261021/evidence/handoff-v1.json`
(SHAe30474ad0fb9c84610162a5b22fd92876100e1dc36ac21f383f2b10927aec69f).

## Bounded behavior

`frontend` accepts an explicit JSON boolean `prototype`. Default/false preserves
one static page. True exports all pages through production exportDesignPrototype
using the same verified design resources. True plus page_id is an explicit
argument error. Output remains create-only and bounded by the existing writer;
no-output results retain the existing1MiB stdout cap.

Only a missing primary prototype sidecar uses the Panel's default: current
active start page and no authored links. Receipts mark absent/defaulted without
creating a sidecar. Existing malformed/oversized files, missing or corrupt
manifest parts, unsafe paths and dangling references are invalid and refuse
prototype export. Every primary/part read goes through NodeProject, preserving
path/symlink and aggregate64MiB protections. Raw/logical sidecar data are capped
at2MiB; oversized manifest declarations refuse before part reads. Shared
readDesignSidecar verifies multipart paths, lengths and hashes.

`validate` returns absent/valid/invalid prototype status and at most100 dedicated
diagnostics with exact truncation counts. Companion errors join the existing
all-page audit/error/blocking totals, so dangling links cannot report valid with
zero issues. Neither checking nor exporting repairs, rewrites or writes the
design/sidecar. Requirement IDs remain ordinary metadata; no regeneration or
automatic node identity reconciliation is claimed.

## Validation evidence

The first7-case owner run retained seven fixture setup failures because its
new Text fixture omitted required textAlign. No product change was needed for
that correction. `targeted-first.log` is retained externally. The corrected
second run passed7/7 in8043.985792ms, including an actual copied-package CLI
export navigated by CPU Chromium at1280/400. Subsequent test-only controls add
empty-present and symlink-part refusal, Offscreen/GPU denial, and browser launch
failure cleanup. Final frozen affected/static results and retained artifacts
are in the external owner handoff receipt for this task.

The first combined owner gate on e7c5f8e retained68total/67pass/1fail: an old
CAS-preservation fixture deliberately saved the non-JSON string `preserved
companion`, then expected validation to ignore it. The new required behavior
correctly reports that metadata invalid. The fixture keeps that exact negative
and its byte-preservation assertion, followed by a separately authored valid
companion for the zero-warning positive. Product source is unchanged by this
test correction. CLI discovery6/6 and every static/generated check passed in
that same historical run; its actual pre/post359-file inventory was unchanged.

The new tests cover strict flags, default/static compatibility, explicit absent
semantics, verified resources, create-only output, malformed/oversize/multipart
and symlink boundaries, exact blocking diagnostic counts and actual node-ID
replacement. Public CLI discovery remains the existing six-package gate.
No generated runtime depends on the new CLI module; generated checks must stay
byte-identical. Root owns independent peer and final combined main/UI gates.

All new browser execution explicitly disables GPU and rejects WebGL/WebGPU.
Actual Host, CanvasKit, native Figma/plugin execution and native reaction
synchronization remain NOT_RUN. External audit sources and historical failures
are preserved; all authored projects are temporary and task-owned.
