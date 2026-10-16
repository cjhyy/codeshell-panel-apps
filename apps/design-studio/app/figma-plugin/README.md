# CodeShell Design Bridge

This local development plugin connects Figma with the CodeShell Design Studio panel through JSON files. It does not access the network or need a Figma access token. It does not read or write binary `.fig` files.

1. In Figma Desktop, use **Plugins → Development → New plugin** to create a plugin with a UI. Copy the `id` from its generated `manifest.json`; Figma must assign this ID.
2. In the Design Studio panel's Figma dialog, expand plugin setup and paste that ID. Download `manifest.json`, `code.js`, and `ui.html` into one folder. Use **Plugins → Development → Import plugin from manifest** to select that downloaded manifest. The bundled manifest is a template without an ID; for manual installation, add your Figma-assigned `id` to it first.
3. Run **CodeShell Design Bridge** and export the current page or selected layers.
4. Open the downloaded `figma-design.json` through Design Studio's Figma JSON import action.
5. Edit the design and download a **complete backup (complete design file)**, an ordinary **CodeShell Design v3** document without external resources, or a **Figma transfer** JSON package. Select the file or paste its complete JSON in this plugin. **Import as new pages** creates an editable copy. For a source-bound document, **Preview original-design changes** lists the targeted properties and conflicts; **Apply reviewed changes** updates the original nodes after that explicit review. Deletions also require the separate reviewed-delete checkbox.

Complete backups (shown as **完整备份**, the complete design file; `codeshell.design.portable-backup` v1/v2) validate the v3 schema, every resource SHA-256 and byte count, image/font MIME signatures, known attachment schemas, attachment hashes, and coverage/count records before conversion or any Figma creation. Only bytes embedded in that file are used; project paths and indexes are never fetched. Ordinary v3 documents with image/font resource descriptors require the complete file. Embedded fonts are verified locally; Figma plugins cannot install font bytes, so editable text requires an available matching font. Missing icon or private-use-character fonts block import; ordinary text may use the reported Inter fallback. Comments, prototype links and source-binding attachments are validated but this action restores design layers only. It does not move cloud comments, prototype interactions, or original-file update bindings. Semantic node notes remain in private plugin data. Unsupported component instances must be expanded before direct import; they cannot silently disappear.

New-page imports validate the entire transfer and preflight all text fonts before creating nodes, then remove only their newly created pages if construction fails. Font Awesome Free uses Solid or Regular and Brands uses Regular. Missing icon fonts and fonts used by Unicode private-use characters (including supplementary planes) fail explicitly without an Inter substitution. Other missing font family/style combinations fall back to Inter Regular and appear in the result report; an unavailable fallback font fails the import. Original-design updates require the source file to match when its file key is available, exact source IDs, and unchanged snapshots for the properties being edited. The plugin repeats this check immediately before applying. Deletes require an unchanged complete subtree. Failures request undo of this plugin's partial update; successful updates are committed as an undoable action. No cloud comments or external libraries are written.

The editable subset includes frames, rectangles, ellipses, plain text, local image fills, solid fills, centered strokes, a single drop shadow, clipping, horizontal/vertical Auto Layout, spacing, padding, constraints, and supported sizing modes. Image bytes travel in a separate bounded asset table and become verified external resources in the design repository. SVG and WebP resources are converted locally to PNG in the plugin UI before importing into Figma. Organizational groups and components are recreated as frames in copies; Grid and reverse layouts retain fixed geometry.

Exported source packages retain official raw node JSON, source IDs, local image bytes, and SVG plus PNG previews for complex vectors, masks, gradients, and mixed text. Complex content appears as a visible image fallback in the design panel. Its paths, variables, component links, rich styles, and unknown Figma properties remain in the source record. Incremental updates modify the reviewed properties while retaining untouched original data and node identities. New-page copies of those fallbacks remain images. This is not a binary `.fig` codec or a universal lossless importer. Layer notes and panel-only layout metadata use private plugin data; they do not become Figma cloud comments. Missing fonts block original text edits rather than replacing original rich text fonts silently.

Limits: 128 MiB for a complete design file; 16 MiB for the converted Figma transfer and existing transfer input; 1,000 pages, 10,000 editable nodes per page, 50,000 nodes per transfer, 32 nested editable levels, 2,048 image assets, 8 MiB per image and 12 MiB total image bytes, 256 complex root previews. Figma image creation supports PNG/JPEG/GIF with a maximum 4K dimension. Large designs should be exported in separate pages or selections. Selected layers whose ancestors are also selected are exported once.

The plugin UI includes a generated, self-contained browser adapter compiled from the same Panel document, portable-file and transfer modules. Its installed `manifest.json`, `code.js`, and `ui.html` need no Node.js, repository checkout, runtime imports, CDN or network permission. The main Figma sandbox keeps the existing validated transfer protocol.

After changing the adapter or its shared schemas, regenerate and check the committed UI from the repository:

```sh
node scripts/build-design-studio-figma-plugin.mjs
node scripts/build-design-studio-figma-plugin.mjs --check
node --test tests/apps/design-studio/figma-plugin-v3.test.mjs tests/apps/design-studio/figma-plugin-ui.test.mjs tests/apps/design-studio/figma-plugin.test.mjs
```

Official API references:

- [JSON_REST_V1 export](https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/)
- [REST export response](https://developers.figma.com/docs/plugins/api/ExportSettings/)
- [Plugin manifest and network permissions](https://developers.figma.com/docs/plugins/manifest/)
- [REST node geometry](https://developers.figma.com/docs/rest-api/file-node-types/)
- [Auto Layout wrapping](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutwrap/)
- [Local image bytes](https://developers.figma.com/docs/plugins/api/Image/)
- [Image creation](https://developers.figma.com/docs/plugins/api/figma/)
- [Fonts and mixed text](https://developers.figma.com/docs/plugins/working-with-text/)
