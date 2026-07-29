# Design Studio Panel App

Design Studio 0.9 is an Agent-native CodeShell Desktop Panel App. One reviewed
installation contributes both its sandboxed visual editor and a narrow Agent
surface: nine declared design tools plus a repository-design Skill.

## What it does

- Vector canvas with selection, collapsible layer hierarchy, frames, alignment,
  distribution, snapping, rotation, zoom, pan, undo, and redo.
- Figma-style horizontal, vertical, wrapped, and Grid layout with independent row/column gaps,
  asymmetric padding, line distribution, column/row spans, dual-axis Hug/Fill/Fixed sizing, and
  absolute children excluded from flow.
- Reusable master components, cross-page/nested instance rendering, cycle-safe composition, and
  bounded acyclic expansion so repeated instances cannot exhaust the canvas or exporter.
- Repository-stable font family, 100–900 weights, italic, letter spacing, text decoration, and
  portable multiline SVG text that does not collapse in native preview renderers.
- Repository-stable drop shadows rendered consistently in canvas screenshots and SVG exports.
- Browser-rendered HTML capture that measures computed layout, typography, borders, clipping, and
  shadows, maps supported CSS Flex/Grid/Wrap and absolute-child semantics to editable v3 Auto
  Layout, and keeps measured coordinates as exact initial geometry and fallback data.
- A guarded **HTML** import dialog and `import_html` Agent tool for workspace-local files: scripts
  and network resources are removed, linked local CSS is inlined, the target viewport is isolated,
  and the converted document remains undoable and revision-guarded.
- Document color tokens whose UI or Agent edits propagate simultaneously through matching canvas,
  fill, stroke, and shadow colors without corrupting color swaps.
- Deterministic v3 `.codesign.json` documents with a compact page switcher, multi-page editing, and
  deeply nested layers.
- Automatic binding to the current repository: recovery first, then the repository's last-opened
  design, then `designs/design.codesign.json`, then the newest remaining design, otherwise a blank
  repo document at the default path.
- A repository file tab that lists every `designs/**/*.codesign.json` document, shows the active
  file and file count, and supports one-click switching or explicit refresh without leaving the
  editor.
- Live reload when an Agent or editor changes the active source file and the
  canvas has no conflicting local edits; stale file-open or sync reads cannot overwrite a newer
  in-memory transaction, and an external check started before a local save cannot mistake that
  save for somebody else's edit.
- Reviewable SVG previews and whole-document accessibility/layout audits that identify the page for
  every issue, detect meaningful rounded-corner clipping, and recompute text contrast in each
  component-instance context after scaling and opacity composition.
- Agent-visible page or full-visible-subtree node screenshots from any page, including
  component-master descendant geometry and shadows in instance crops, for an edit → validate →
  inspect → refine loop. Read tools wait for queued saves without mutating the live document, and a
  screenshot fails closed if its source changes during image rendering.
- Optimistic-concurrency checks before overwriting repository files.
- A required live `stateRevision` guard on Agent edits and explicit saves, covering unsaved human
  edits, undo/redo, page switches, `save: false` Agent transactions, and workspace changes.
- Explicit Host permissions for workspace access, app storage, current-session
  context, and optional prompt submission.
- Structured Agent reads, transactional edits, blocking validation, screenshots,
  design-system search across tokens and component masters,
  serialized mutation/read consistency, pending field/drag settlement at the Agent boundary, safe
  latest-transaction rollback, workspace-transition and complete queued UI-save settlement before
  Agent access, temporary interaction locking during Agent writes, user-aware selection
  restoration/preservation, net-zero transactions that cannot replace the latest real rollback
  token, and state-aware serialized saves that cannot silently reuse an older in-flight snapshot or
  be skipped after an earlier save fails.
- Agent page transactions for create, rename, activate, and delete, kept separate from node edits so
  layout work cannot leak across pages. A component-library page cannot be deleted while another
  page still contains instances linked to its masters.
- Visual-region screenshots crop to rendered geometry: rotated node outlines and rounded/rotated
  clipping ancestors are intersected before cropping, clipped descendants and organizational group
  bounds cannot add blank margins, while non-clipped component-master overflow and effects remain
  visible on instance crops.

Nested node geometry uses absolute canvas coordinates. Manual-layout containers preserve
Agent-authored `x/y`; auto-layout containers own direct flow children while
`layoutPositioning: "absolute"` children retain their coordinates. Reflow runs only after relevant
structural, visibility, sizing, or layout-property changes. Direct canvas dragging, nudging,
alignment, and distribution cannot bypass flow ownership. Agent-created
nodes require a stable lowercase, hyphen-separated semantic id so transactions are
reproducible and later operations can address every new node explicitly.

## Install

Open **Extensions → Panel Apps → From folder**, then select this directory.
CodeShell validates `.codeshell-panel/panel.json`, shows a permission review,
and installs it into the independent Panel App registry.

Continue editing this directory in the repository. To load those changes, use
**Extensions → Panel Apps → Update from source** on the Design Studio card,
review the new package digest and permissions, then confirm the update.

Design files belong to the repository that is currently open in CodeShell and
live below `designs/`. They are not shared globally between projects. The panel
header shows the connected repository, and the inspector's **文件** tab keeps
that repository's `.codesign.json` files visible with the current document
highlighted. The top-bar file picker remains available for keyboard-driven
switching.

The optional repository checker is bundled at `app/tools/check-design.mjs`. Run it from the
repository root to make canonical JSON and a zero-warning audit a CI-style gate:

```sh
node examples/panel-apps/design-studio/app/tools/check-design.mjs \
  --strict-audit designs/design.codesign.json
```

Add `--check-svg` when the repository also keeps a sibling generated SVG preview and it must match
the current active page exactly.

## HTML fidelity fixture

Use the top-bar **HTML** action to convert a workspace-relative `.html` file, or call the
revision-guarded `import_html` Agent tool. The reusable browser capture helper lives at
`app/html-capture.mjs`. The fixture at
`tests/fixtures/design-studio-html-capture/` renders a representative product UI in `mode=source`
and the captured Design SVG in `mode=converted`. Capture both at the same 960×640 viewport and
compare their pixels; the source, converted, and amplified difference images make baseline,
shadow, clipping, and corner errors visible before they reach a real design.

Run the same-browser regression from this collection repository:

```sh
npm run test:fidelity -- --output artifacts/design-studio-html-fidelity
```

The command writes source, measured conversion, reflowed conversion, side-by-side, amplified
pixel-difference, captured/reflowed `.codesign.json`, and JSON report artifacts. The measured
conversion fails unless windowed SSIM is at least `0.99`, pixels changing by more than 8 channel
levels stay at or below `1%`, and pixels changing by more than 24 levels stay at or below `0.6%`.
The fixture must retain at least 20 Auto Layout containers. After resolving those layouts once,
windowed SSIM must remain at least `0.97`, with the changed-pixel ratios at or below `2%` and
`1.5%`. Both documents must have zero blocking audit issues.
Browser-measured text bounds and explicitly clipped imported effects remain tagged in the editable
document so the audit does not replace exact geometry with fallback estimates; real contrast,
layout, and clipping issues still fail validation normally.

This path deliberately captures the browser's computed result after fonts and layout settle.
Flex rows/columns map Wrap, axis gaps, four-side padding, alignment, distribution, and Fill/Fixed
sizing into v3. Grid maps equal computed columns and row/column spans; direct absolute/fixed
children are excluded from flow. Reverse directions, unequal Flex grow, floats, unequal Grid
tracks, and decoration-heavy controls keep measured manual geometry. It is not an HTML parser and
does not promise fidelity for unsupported visual primitives such as raster images, SVG paths,
gradients, pseudo-elements, multiple shadows, or four independently editable corner radii.

## Package boundary

Renderable code lives under `app/`. The declarative Agent contribution lives
under `agent/`: the manifest declares every callable tool, handlers execute
inside the panel sandbox, and the bundled Skill is read-only Markdown. The
installer still rejects traditional plugin backends, hooks, commands, and MCP
configuration, so one install does not collapse the runtime isolation.
