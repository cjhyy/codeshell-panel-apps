---
name: project-runtime
description: Create, inspect, validate, edit and exchange Video Studio schema-2 project JSON from Chat or a terminal without opening the panel; plan export settings using the same editor domain.
---

# Video Studio project CLI

Use this runtime for a direct Chat or terminal request. Resolve `../../..` from
`${CODESHELL_SKILL_DIR}` to get the current project's selected package. Confirm
its `.codeshell-panel/panel.json` has id `video-studio` and that
`app/tools/video-studio.mjs` exists. Keep package files read-only. Do not select
another installed version or a development checkout; report
`bundled-video-studio-cli-not-found` if that package is unavailable.

Use the actual environment's Node.js >=20.10. Read `ops` for this package's
commands and input contracts. Pass the trusted current project as an explicit
absolute `--project`. Write structured arguments to a properly quoted
`--input-file`; no shell fragments or executable source are accepted.

```sh
node "<package>/app/tools/video-studio.mjs" ops
node "<package>/app/tools/video-studio.mjs" init --project "<project>"
node "<package>/app/tools/video-studio.mjs" inspect --project "<project>"
node "<package>/app/tools/video-studio.mjs" edit --project "<project>" --input-file "<request.json>"
node "<package>/app/tools/video-studio.mjs" plan --project "<project>" --input-file "<request.json>"
```

The independent CLI slot is `<project>/video-studio-cli.json`. It contains a real
schema-2 editor document, with 240000 ticks per second and rational frame rates.
It is separate from the panel's current document and Host tasks/resources.
Opening a panel does not import or replace this CLI slot. Do not read private
Host storage, invent resource grants, or claim that a CLI save changed the panel.

`init` creates a missing empty project and preserves an existing project. Optional
input fields are `name`, `width`, `height`, and
`frameRate:{numerator,denominator}`. It creates no example facts or media.
`inspect` uses the editor's bounded JSON-pointer paging contract. Pass `path`,
`offset`, `limit` (1–100), and `format:"tree"|"json"`; `view:"defaults"` reads
the complete shared transform, color, audio and text defaults. Continue to
`nextOffset:null`, expanding returned paths rather than treating summaries as
complete values. For `format:"json"`, join the page's text with the same
`expectedRevision`. Do not use the panel's ephemeral SessionIdentity as a CLI
revision.

Before `edit` or `import`, read the current CLI revision and place it in
`expectedRevision`. `edit` (alias `apply`) takes `{expectedRevision,label,steps}`.
Steps use the same planner contract documented by `video-studio:editor-v2`:
`operations`, `sequence`, `captions`, `multicam`, `marker`, `split`, `trim`,
`timing`, `move`, `remove`, `transition`, `arrange`, `group`, `ungroup`, and
`duplicate`. Only its step descriptions apply here; its Panel invocation,
SessionIdentity, grants, sync and native-task workflows are not CLI commands.
Use `inspect` defaults when constructing complete clip properties. For example:

```json
{
  "expectedRevision": "<revision returned by inspect>",
  "label": "Rename project",
  "steps": [
    { "kind": "operations", "operations": [{ "type": "project.rename", "name": "My video" }] }
  ]
}
```

The shared planners preserve captions, groups, transitions, locked tracks and
exact time maps. One successful batch advances the document revision once.
Changes to approved narration dependencies invalidate that imported approval;
generic operations cannot create approval or import/delete media. A conflict
returns `REVISION_CONFLICT`; reread the relevant context and replan instead of
changing only the revision or blindly replaying. There is no automatic retry.

Explicit file exchange is supported:

- `validate` with no input validates the saved slot; with
  `{documentFile:"<explicit JSON file>"}` it validates that standalone schema-2
  document without initializing a project.
- `import` accepts `{expectedRevision,documentFile:"<explicit JSON file>"}` and
  replaces only the CLI slot after validation. Export schema-2 JSON through the
  panel's project-JSON action before importing an existing panel project.
- `export` accepts `{output:"exports/project-v2.json",expectedRevision?}` and
  creates a schema-2 JSON file below the CLI project without overwriting any file.
  That file can be explicitly imported through the panel's project-JSON action.

Project JSON does not contain source-media bytes or grant access to resource IDs.
These commands do not create a media-inclusive `.mimiproject` bundle. Keep source
media available and reconnect it through the authorized panel workflow as needed.
Do not claim portable media from a successful JSON export.

`plan` accepts optional `sequenceId`, `profileId` or complete `profile`, `range`,
and `expectedRevision`. It validates the export settings, half-open tick range,
rational frame count, encoder names and audio-plan summary. It does not probe
installed encoders or source files and produces no video. Use the authorized
panel flow for real media import, rendering, transcription, TTS, source recording,
sync and `.mimiproject` packages; report these boundaries explicitly when needed.
`requestedRangeSampleCount` counts original-clock 48 kHz samples in the requested
range; the separate `fullSequence*` audio fields describe the complete sequence,
including stateful audio dependencies. They do not claim a rendered or encoded
range mix.

The CLI prints one bounded JSON receipt on stdout. Require `ok:true` before
reporting a save. Exit codes are 0 success, 2 invalid arguments/input limits,
3 revision conflict, 4 project busy, and 1 other failures. Requests are limited
to 256 KiB; documents to 32 MiB; output to 64 KiB. Writes use private temporary
files, atomic publication, SHA-256 CAS and the project-root
`.video-studio-cli-write.lock`. Locks wait at most five seconds; a crashed writer
may leave its lock. Verify that no CLI writer is active before manually removing
it, and never clear it merely because a command timed out. This protocol is for
participating CLI writers; never hand-edit a live CLI slot concurrently.
