# Prepare a Figma source for workspace import

`prepare-figma.mjs` is a package-local Node 20+ companion. Resolve it from the
project's selected Design Studio package. It prepares local files without an
open panel, provider request, credentials, or a change to the live design.

```sh
node /path/to/selected-design-studio/app/tools/prepare-figma.mjs \
  --project /absolute/project \
  --input /absolute/path/to/figma-response.json \
  --output designs/imported-page.figma-source.json
```

Relative input paths resolve against `--project`; the project defaults to the
current directory. Output must be a portable relative path below `designs/`,
ending in `.figma-source.json`. Pick a new basename: existing roots, including
symlinks, are never overwritten. The original input is always preserved.

With no arguments, stdin accepts one JSON request:

```json
{
  "project": "/absolute/project",
  "input": "downloads/page.json",
  "output": "designs/imported-page.figma-source.json"
}
```

With flags, `--input -` instead accepts the complete Figma JSON directly on stdin.
Stdout always contains one JSON receipt; success exits `0`, failure exits `1`.
The receipt reports `outputPath`, `mode`, original source `bytes` and `sha256`,
node/root counts, and created/reused chunk counts. Errors contain `ok: false`
and `error.code`/`error.message`. No file contents are printed.

Accepted input is complete Figma REST JSON (`document` or `nodes`), a supported
raw official node, html2figma plugin FigmaJSON (one node, a root array, or
`{ "nodes": [...] }`), or a `codeshell.figma.source` package. Plugin JSON keeps
parent-relative geometry and top-level typography; the importer normalizes it
when creating the editable document. Optional `sourceUrl` resolves relative
links. An explicit `fontAssets` table can carry locally supplied complete fonts
with `family`, `weight`, `style`, `mime`, and canonical `base64` per face; system
font availability alone does not provide those bytes. Explicit successful
Figma `LinkAction` result envelopes are unwrapped to their complete `data`.
The existing source validator checks structure and the 16 MiB/50,000-node/depth
bounds; missing node trees, malformed UTF-8, and marked truncation are rejected.
The original source fields are preserved rather than converted into a design.
This does not establish visual fidelity, complete file coverage for a selected
subtree, or the availability of external image/font assets.

Sources up to 350 KiB remain a single UTF-8 file. Larger sources use the existing
`codeshell.design.sidecar` v1 manifest and SHA-256 addressed chunks of at most
350 KiB, safely below the Host's 480 KiB text read budget. The existing
`exchange_figma` import tool can read the resulting `outputPath`.

Before any writes, all existing chunk collisions are checked. Identical chunks
may be reused; conflicting or symlinked chunks fail. Complete files are staged,
synced, and published using create-only atomic links; the root is published last.
Concurrent publishers cannot replace an existing root. Errors do not delete
existing project files. An interrupted preparation may leave immutable chunks
without a root; a retry with a new or still-absent output path can reuse them.
The filesystem must support hard links within the output directory.

Offline verification uses only temporary projects:

```sh
node --test tests/apps/design-studio/prepare-figma-cli.test.mjs
```
