# Design Studio Panel App

Design Studio is an independent CodeShell Desktop Panel App. It is not an
agent plugin and deliberately contains no Skill, MCP server, Agent, Command, or
Hook.

## What it does

- Vector canvas with selection, frames, hierarchy, alignment, distribution,
  snapping, rotation, zoom, pan, undo, and redo.
- Deterministic `.codesign.json` repository documents.
- Reviewable SVG previews and built-in accessibility/layout audits.
- Optimistic-concurrency checks before overwriting repository files.
- Explicit Host permissions for workspace access, app storage, current-session
  context, and optional prompt submission.

## Install from GitHub

Open **Extensions → Panel Apps → From GitHub** and enter:

- Repository: `https://github.com/cjhyy/codeshell-panel-apps`
- Branch or tag: `main`
- App subdirectory: `apps/design-studio`

CodeShell validates `.codeshell-panel/panel.json`, shows a permission review,
and installs it into the independent Panel App registry.

## Local development

Open **Extensions → Panel Apps → From folder**, then select this directory.

Continue editing this directory in the repository. To load those changes, use
**Extensions → Panel Apps → Update from source** on the Design Studio card,
review the new package digest and permissions, then confirm the update.

The optional repository checker is bundled at
`app/tools/check-design.mjs`; it is a document utility, not an agent command.

## Package boundary

Everything executable or renderable lives under `app/`, beside the declared
HTML entry. The package cannot be installed through the normal Plugin
installer, and the Panel App installer rejects agent-plugin content.
