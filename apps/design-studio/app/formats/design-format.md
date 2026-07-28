# CodeShell Design v3 repository format

The authoritative source ends in `.codesign.json`. Design Studio now reads and writes v3 only; the
first release intentionally carries no v1/v2 migration path because existing design content is not
being preserved.

```json
{
  "format": "codeshell.design",
  "version": 3,
  "name": "Product UI",
  "canvas": {
    "width": 1440,
    "height": 960,
    "background": "#f5f5f2"
  },
  "tokens": {
    "colors": [{ "name": "Ink", "value": "#171717" }]
  },
  "activePageId": "page-1",
  "pages": [
    {
      "id": "page-1",
      "name": "Page 1",
      "children": []
    }
  ]
}
```

## Repository binding and live sync

Each project gets its own active file and recovery snapshot. The panel restores recovery, reopens
the last file, otherwise opens the newest file below `designs/`, and finally starts at
`designs/design.codesign.json`. A clean canvas reloads repo edits automatically. A dirty canvas
shows a conflict instead of overwriting either side.

Design Studio's bundled Agent tools operate on the same in-memory document, refresh the canvas
immediately, and save to the active repo source by default. This avoids the delay and ambiguity of
asking an Agent to perform blind text replacement.

## Recursive layers

Pages contain recursive `children`. Frames, groups, and components are containers and may contain
any supported node, including another container. Repository JSON does not use `parentId`; that is a
temporary flat-editor representation.

All nodes have stable ids, names, geometry, fill/stroke, opacity, rotation, visibility, and lock
state. Optional `notes` carry implementation, interaction, responsive, and accessibility intent.

Supported node types:

- primitives: `rectangle`, `ellipse`, `text`;
- containers: `frame`, `group`, `component`;
- reusable references: `instance`, linked with `componentId`.

## Auto layout and components

Containers store `layout`, `gap`, `padding`, `alignItems`, and `justifyContent`. Children may use
`layoutGrow` and `layoutAlign`. Nested auto-layout is resolved deepest-first and current geometry is
kept explicit so Git diffs and Agent reads remain understandable.

A component is a visible master subtree. Instances store `componentId` and their own bounds.
Editing a master updates every instance. Deleting a master removes its instances.

## Determinism

JSON is pretty-printed with stable property order and a trailing newline. Colors are lowercase.
Unknown fields, dangling component references, duplicate ids, invalid page references, and trees
deeper than 32 levels are rejected.

Limits are 20 pages, 500 nodes total, 32 color tokens, and 192 KiB per source. Use
`codeshell-design-v3.schema.json` for repository validation. SVG and `*.audit.md` are generated
review artifacts, never authoritative sources.
