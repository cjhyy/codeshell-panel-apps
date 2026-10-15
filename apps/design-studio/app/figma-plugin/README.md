# CodeShell Design Bridge

This local development plugin connects Figma with the CodeShell Design Studio panel through JSON files. It does not access the network or need a Figma access token. It does not read or write binary `.fig` files.

1. In Figma Desktop, use **Plugins → Development → New plugin** to create a plugin with a UI. Copy the `id` from its generated `manifest.json`; Figma must assign this ID.
2. In the Design Studio panel's Figma dialog, expand plugin setup and paste that ID. Download `manifest.json`, `code.js`, and `ui.html` into one folder. Use **Plugins → Development → Import plugin from manifest** to select that downloaded manifest. The bundled manifest is a template without an ID; for manual installation, add your Figma-assigned `id` to it first.
3. Run **CodeShell Design Bridge** and export the current page or selected layers.
4. Open the downloaded `figma-design.json` through Design Studio's Figma JSON import action.
5. Edit the design and export a **Figma transfer** JSON package. Select that file in this plugin and click **Import as new pages**.

Imports always create new pages. They never replace existing Figma nodes, pages, comments, or libraries. The plugin validates the entire transfer before creating nodes and removes only its newly created pages if construction fails. Missing font family/style combinations fall back to Inter Regular and appear in the result report. An unavailable fallback font fails the import.

The editable subset includes frames, rectangles, ellipses, plain text, solid fills, centered strokes, a single drop shadow, clipping, horizontal/vertical Auto Layout, spacing, padding, and supported sizing modes. Organizational groups and components are recreated as frames. Grid and reverse layouts retain fixed geometry. Images, vector paths, masks, gradients, mixed text styling, variable bindings, component links/variants, and prototype interactions are not a lossless round trip; Design Studio reports unsupported input and export details. Source IDs and layer notes are stored as private plugin data on the new nodes. Notes are not Figma cloud comments.

Limits: 16 MiB JSON input, 1,000 pages, 10,000 nodes per page, 50,000 nodes per transfer, 32 nested levels. Large designs should be exported in separate pages or selections. Selected layers whose ancestors are also selected are exported once.

Official API references:

- [JSON_REST_V1 export](https://developers.figma.com/docs/plugins/api/properties/nodes-exportasync/)
- [REST export response](https://developers.figma.com/docs/plugins/api/ExportSettings/)
- [Plugin manifest and network permissions](https://developers.figma.com/docs/plugins/manifest/)
- [REST node geometry](https://developers.figma.com/docs/rest-api/file-node-types/)
- [Auto Layout wrapping](https://developers.figma.com/docs/plugins/api/properties/nodes-layoutwrap/)
