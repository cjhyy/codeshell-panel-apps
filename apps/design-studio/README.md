# Design Studio Panel App

Design Studio is an Agent-native CodeShell Desktop Panel App. One reviewed
installation contributes both its sandboxed visual editor and a narrow Agent
surface: five declared design tools plus a repository-design Skill.

## What it does

- Vector canvas with selection, collapsible layer hierarchy, frames, alignment,
  distribution, snapping, rotation, zoom, pan, undo, and redo.
- Figma-style horizontal and vertical auto layout with gap, padding, alignment,
  space distribution, stretch, and grow controls.
- Reusable master components and linked instances.
- Deterministic v3 `.codesign.json` documents with recursive pages and nested layers.
- Automatic binding to the current repository: recovery first, then the
  repository's last-opened or newest design, otherwise a blank repo document.
- Live reload when an Agent or editor changes the active source file and the
  canvas has no conflicting local edits.
- Reviewable SVG previews and built-in accessibility/layout audits.
- Optimistic-concurrency checks before overwriting repository files.
- Explicit Host permissions for workspace access, app storage, current-session
  context, and optional prompt submission.
- Structured Agent reads, transactional edits, validation, and saves that update
  the live canvas immediately.

## Install

Open **Extensions → Panel Apps → From folder**, then select this directory.
CodeShell validates `.codeshell-panel/panel.json`, shows a permission review,
and installs it into the independent Panel App registry.

Continue editing this directory in the repository. To load those changes, use
**Extensions → Panel Apps → Update from source** on the Design Studio card,
review the new package digest and permissions, then confirm the update.

Design files belong to the repository that is currently open in CodeShell and
live below `designs/`. They are not shared globally between projects. The panel
header shows the connected repository, and the file picker lets you switch
among that repository's `.codesign.json` files.

The optional repository checker is bundled at `app/tools/check-design.mjs`.

## Package boundary

Renderable code lives under `app/`. The declarative Agent contribution lives
under `agent/`: the manifest declares every callable tool, handlers execute
inside the panel sandbox, and the bundled Skill is read-only Markdown. The
installer still rejects traditional plugin backends, hooks, commands, and MCP
configuration, so one install does not collapse the runtime isolation.
