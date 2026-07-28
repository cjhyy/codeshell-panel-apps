---
name: repo-design
description: Inspect and edit the active repository's CodeShell Design v3 source through Design Studio's structured Agent tools.
---

# Repository design workflow

Use the installed Design Studio Panel App as the authoritative structured editor for
`designs/*.codesign.json`.

1. Call the built-in `Panel` tool with `action: "tools"` and
   `panel_id: "panel-app:design-studio"` when you need the live tool schemas.
2. Call `get_design_metadata` before editing. Reuse stable node ids and inspect the smallest
   relevant subtree with `get_design_context`.
3. Call `use_design` with a short transaction of operations. It refreshes the live canvas and
   saves the active repo source by default.
4. Call `validate_design` after a meaningful edit. Fix schema errors, broken component references,
   clipping, text overflow, and contrast issues before finishing.

Supported `use_design.operations`:

- `{"op":"create_node","type":"frame|group|component|instance|rectangle|ellipse|text","id":"stable-id","parent_id":"optional-container","before_id":"optional-sibling","properties":{...}}`
- `{"op":"update_node","node_id":"stable-id","changes":{...}}`
- `{"op":"move_node","node_id":"stable-id","parent_id":"container-or-null","before_id":"optional-sibling"}`
- `{"op":"delete_node","node_id":"stable-id"}`
- `{"op":"set_document","changes":{"name":"…","canvas":{...},"tokens":{...}}}`

Prefer semantic names and stable ids. Use frames for screens and sections, groups for organization,
components for reusable masters, and instances for reuse. Put repeated spacing into auto-layout
containers instead of manually positioning every child. Do not edit generated SVG or audit Markdown
as if they were source.

The v3 repository format is a recursive page/node tree. `parentId` is an editor-internal field and
must not be written into repo JSON; nested source nodes use `children`.
