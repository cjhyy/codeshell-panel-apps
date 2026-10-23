---
name: project-runtime
description: Make a real video from a terminal or any agent session without opening the panel - add local footage, edit the timeline, generate narration, transcribe, render a verified MP4 and look at its frames - using the Video Studio project CLI and the panel's own editor and renderer.
---

# Video Studio project CLI

Use this runtime for a direct Chat or terminal request. Resolve `../../..` from
`${CODESHELL_SKILL_DIR}` to get the current project's selected package. Outside
CodeShell (no `CODESHELL_SKILL_DIR`, e.g. Codex or Claude Code), use the installed
package `~/.code-shell/panel-apps/video-studio`. Confirm its
`.codeshell-panel/panel.json` has id `video-studio` and that
`app/tools/video-studio.mjs` exists and `ops` lists `render`. Keep package files
read-only. Do not select another installed version or a development checkout;
report `bundled-video-studio-cli-not-found` if that package is unavailable.

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
node "<package>/app/tools/video-studio.mjs" render --project "<project>" --input-file "<request.json>"
```

## Making a video

Work in the user's project directory, as you would with any code. A complete
pass is:

1. `init` (optionally `{name,width,height,frameRate}`), then `inspect` for the
   revision.
2. `add-media` with `{expectedRevision,files:[{path,name?}],place?,at?,imageSeconds?}`.
   Files are read in place, never copied; outside paths may be absolute. By
   default each file is appended to the main picture track (images last
   `imageSeconds`, default 5) or the first audio track; `place:"none"` only adds
   the asset; `at` (sequence seconds) places it on a free track. The receipt
   returns `assetId`, clip IDs and seconds. Same bytes reuse their asset.
3. Shape the cut with `edit` steps (trim, split, move, transitions, titles,
   captions...) as described below, re-reading the revision after each save.
4. Narration: `voices` (`{language:"zh"}` filters) lists models; `macos-say` works
   offline on macOS. Install `edge-tts` (natural online voices such as
   `zh-CN-XiaoxiaoNeural`) or `kokoro` once per device with `setup-voice
   {providerId}`. `voiceover {expectedRevision,text,modelId?,voiceId?,rate?,at?}`
   writes `media/voiceover-<hash>.wav`, adds it, and places it when `at` is given.
   Generate narration per paragraph and place each at its moment.
5. Captions: `transcribe {assetId|path,language?,model?}` runs local Whisper and
   writes `transcripts/*.json` and `*.srt` in the media file's own seconds. When
   that audio starts at sequence 0 with no trim, import the SRT text with an
   `edit` step `{kind:"captions",sequenceId,action:{kind:"import-srt",text}}`;
   otherwise shift times by the clip's start and in-point first. For your own
   narration you can also add captions directly from the script.
6. `render {output:"renders/<name>.mp4",profileId?|profile?,range?,sequenceId?}`
   renders with the panel's own renderer (FFmpeg + Chrome) and verifies the file.
   It never overwrites; choose a new name per pass. Use `range` (ticks) for a
   quick partial check; a small `profile` (e.g. 640x360) speeds up drafts.
7. Look before you report: `frames {path:"renders/<name>.mp4",times:[...],output}`
   writes JPEGs and `sheet.jpg`; open the sheet image and check framing, text and
   timing. Fix with `edit`, render to a new file, look again.

Long commands print progress lines on stderr; stdout stays one JSON receipt.
Device state (voice engines, render caches, temporary jobs) lives in
`VIDEO_STUDIO_CLI_HOME` or `~/.cache/video-studio-cli`; set
`VIDEO_STUDIO_BROWSER` if Chrome is not in a standard place. Missing tools fail
with `MISSING_DEPENDENCY` naming what to install (FFmpeg, Whisper, uv for voice
engines). `SOURCE_CHANGED`/`SOURCE_MISSING` mean registered footage moved or
changed: `add-media` it again. `MEDIA_NOT_REGISTERED` means the document uses
media this project never registered (for example an imported panel project).

The independent CLI slot is `<project>/video-studio-cli.json`. It contains a real
schema-2 editor document, with 240000 ticks per second and rational frame rates.
It is separate from the panel's current document and Host tasks/resources.
`<project>/video-studio-media.json` lists the registered local files (path,
size, SHA-256); the document itself holds only `external-<sha256>` resource IDs.
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
generic operations cannot create approval or import/delete media (use
`add-media` to add media). A conflict
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
These commands do not create a media-inclusive `.mimiproject` bundle. A panel
project imported here needs its media added again with `add-media` before it can
render; in the panel, reconnect CLI media through its own import. Do not claim
portable media from a successful JSON export.

`plan` accepts optional `sequenceId`, `profileId` or complete `profile`, `range`,
and `expectedRevision`. It validates the export settings, half-open tick range,
rational frame count, encoder names and audio-plan summary. It does not probe
installed encoders or source files and produces no video; `render` does. Source
recording, multicam sync and `.mimiproject` packages remain panel workflows.
`requestedRangeSampleCount` counts original-clock 48 kHz samples in the requested
range; the separate `fullSequence*` audio fields describe the complete sequence,
including stateful audio dependencies. They do not claim a rendered or encoded
range mix.

The CLI prints one bounded JSON receipt on stdout. Require `ok:true` before
reporting a save or a rendered file. Exit codes are 0 success, 2 invalid
arguments/input limits, 3 revision conflict or existing output, 4 project busy,
and 1 other failures. Requests are limited
to 256 KiB; documents to 32 MiB; output to 64 KiB. Writes use private temporary
files, atomic publication, SHA-256 CAS and the project-root
`.video-studio-cli-write.lock`. Locks wait at most five seconds; a crashed writer
may leave its lock. Verify that no CLI writer is active before manually removing
it, and never clear it merely because a command timed out. This protocol is for
participating CLI writers; never hand-edit a live CLI slot concurrently.
