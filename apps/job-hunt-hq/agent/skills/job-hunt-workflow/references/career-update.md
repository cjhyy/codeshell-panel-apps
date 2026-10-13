# Write a career update JSON file

Use this interface when chat should produce one reviewable file that the Panel
can preview and apply. Read [career-update.schema.json](career-update.schema.json)
for exact fields and [career-update.example.json](career-update.example.json)
for a complete synthetic example. Replace every synthetic example fact and ID;
never treat the example as the user's career evidence.

The file is an incremental update, not a replacement project snapshot. Keep the
conversation, Link collection and factual questions in the current session.
Read current records first and reuse their stable IDs; when referring to a
record in this update, use the exact ID assigned to that record. New IDs use
`career-source-`, `career-episode-`, `career-qa-` or `career-version-` plus 1–80
letters, digits, underscores or hyphens. A source's `connectionId` is the actual
opaque Link connection ID, never an invented account label.

## Produce and apply the file

1. Use the available File tool to write a UTF-8 JSON file under
   `career-data/updates/<safe-name>.json` in the current project. The filename
   contains 1–100 letters, digits, underscores or hyphens before `.json`.
   Do not write `job-hunt-panel.json` or Panel shards directly. Writing the
   update file alone does not import it.
2. Include exactly `format: "codeshell.career-update"`, `schemaVersion: 1`,
   `version`, `sources`, `episodes` and `qa`. All three arrays are required;
   each holds at most 25 records and together they must contain at least one.
   The entire original UTF-8 file is limited to 128 KiB. Split a larger task
   into separate meaningful updates, each with a different version ID.
3. `version` requires `id` and a recognizable `title` (1–240 characters), with
   optional `summary` (at most 2,000). Records require `id`; sources also
   require `provider`, episodes require `title`, and QA requires `question`.
   Preserve provenance, unknowns, the user's actual `answer`, and separate
   AI wording in `draftAnswer`. Only draft `status` is allowed; JSON cannot
   carry `confirmation`, actors, timestamps of confirmation or other internal
   metadata. An edit to an already reviewed fact stays a pending revision.
4. Call the existing Panel tool with:

   ```json
   {"career_update":{"action":"preview","path":"career-data/updates/decision-notes.json"}}
   ```

   Show the proposed additions, updates, pending changes and unresolved facts
   in chat. Preview validates the file and computes the merge without changing
   the working library or creating a named version. If validation fails,
   correct the file and preview again; preserve existing project data.
5. When saving is authorized by the user's current or earlier request, apply
   directly using the exact `preview_token` returned by preview:

   ```json
   {"career_update":{"action":"apply","path":"career-data/updates/decision-notes.json","preview_token":"<exact 64-character token from preview>"}}
   ```

   Do not invent a token or ask for routine authorization again. If the user
   requested only a file or a preview, stop there. Apply uses one atomic project
   update for the incremental records and their named knowledge-library
   version. Do not pre-save the same records through single-record tools or
   create a separate `library_version` for this batch.

The token binds the exact original file bytes, current project identity, working
career collections and version index. A file or library change requires a new
preview; never force an old token through. The token is an opaque review result,
not the file SHA-256. A successful apply returns the actual saved version ID.

If apply times out or its receipt is lost, the save may still be running: a Host
tool timeout does not cancel the Panel operation. First query the exact intended
version with `get_job_search_context`:

```json
{"scope":"career_versions","version_id":"career-version-your-stable-id"}
```

If that version is attached, use the saved result. If a save is still in progress,
wait for it to finish and query again. An absent version alone does not prove
failure. Do not blindly repeat apply or change the version ID to create another
version; only after the save is known to have failed, retry the same file and
version ID (preview again if its token is no longer valid).

A retry of the same version ID and exact file bytes is idempotent: return the
already saved version while preserving any later working edits. Changed file
content must use a new version ID; an existing immutable version cannot be
rewritten. A failed project commit may leave an unindexed immutable version
file; retrying the same update can verify and attach it without overwriting it.
Internal result metadata may contain `updateSha256` for the original UTF-8 file;
never add that field to the update JSON.

There is no HTTP endpoint, listening port or background directory scan. The
Panel reads only the requested project file when preview/apply is invoked;
the file itself does not trigger an import. Live single-record tool updates
remain available for other workflows. Saving this JSON update does not confirm
all facts, publish private evidence, or generate a resume.

## Validation boundaries

Unknown fields and duplicate JSON object keys are errors. IDs must match their
record kind; references must resolve to current or incoming records. Repeated
record IDs, conflicting source identity and attempts to repoint an existing
source to another account or locator are rejected. Source records need a
nonblank `externalId`, `url`, `localRef` or actual `excerpt`; a URL alone does
not establish the candidate's contribution. Whitespace-only required text is
invalid. Limits use the Panel's string bounds so an accepted value is not
silently shortened during the merge. No preview/apply operation fetches Link
content automatically: collect authorized material before writing the file.
