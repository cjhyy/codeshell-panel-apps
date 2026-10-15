# Mimi Download

Mimi Download 0.24.1 provides one project download runtime for Chat, the Node CLI
and the panel. Public downloads saved inside the project share task IDs,
configuration, queue settings, progress and files. Opening a panel observes those
records; it does not own or keep the worker alive.

## Download from Chat, a terminal or the panel

Ask Chat to search or download a video. The selected package's
`video-download-cli` Runtime Skill supplies the exact installed command. Chat
uses the current conversation to interpret the request and rank public search
results; the CLI has no separate model connection or credentials.

The panel retains batch links, metadata inspection, playlist selection, quality
preferences, MP3, human/automatic subtitles, language presets, AI search and error
analysis. Paste up to 100 links. **Download now** admits work to the project queue;
**Add to queue** saves a pending task without starting a worker. Optional playlist, subtitle and account controls live under **More options**;
quality and destination remain visible. Start pending work explicitly
from the task card or **Start pending downloads**. Existing matches and actual
output files are checked before treating a video as already downloaded.

The shared queue defaults to two concurrent downloads and supports one to four.
Queue settings persist per project and are visible to every entry point. Pausing
the shared queue stops new admission; currently running downloads continue.
Cancel a task to stop it, then explicitly retry to reuse its partial files.
Lowering concurrency does not kill running tasks. Each worker confirms its owned
process tree has exited before releasing its slot.

Tasks and History automatically discover downloads created by Chat or terminals,
including when the list was empty. Cards and history retain their real backend
identity. The same controls can start pending tasks, cancel, retry, check files or
archive records. Archiving and clearing history never delete downloaded media.
File opening and playback recheck actual files and use an authorized directory;
a path in task JSON is never a directory grant. External CLI outputs require the
original directory to be selected before panel file actions.

## Runtime and environment state

Installed CLI commands are available without an open panel. Workers start only
for submitted work and exit when done; there is no permanently idle daemon or
operating-system login service. Closing the panel stops observation and short
page-owned queries, not independent download workers. A running machine and
execution environment are still required. Interrupted work is never restarted
without an explicit request.

Environment snapshots are shared between the panel and CLI. Local executable
versions are cached for up to six hours; failed observations expire after one
minute. Tool probes allow up to 30 seconds for slow standalone startup and settle
concurrently before returning. Snapshots are bound to the actual PATH, relevant
execution settings, Node and tool file identities. File replacement, missing
tools or changed settings invalidate the cache. Shell/session bookkeeping does
not invalidate an otherwise identical environment. Each panel still obtains its
own current Host executable grants; no opaque handles or credentials are cached.

The initial task list includes queue state, avoiding redundant native startup
queries. Short process lifecycle calls back off within a fixed budget only when
the Host explicitly rejects them with `RATE_LIMITED`; unknown replies are never
replayed. Failed commands await a bounded stop request, and the Host retains
execution custody until the actual process has exited.

The official yt-dlp latest-release query has its own 24-hour cache and runs
separately from local readiness. Network failure does not mark working local
tools unusable. Use **Refresh dependencies** or `doctor --refresh` after repair;
`doctor --latest` explicitly includes the remote query. Diagnostic `doctor` also
checks yt-dlp's optional JavaScript-runtime support; actual operations verify
that capability when used.

Node >=20.10, yt-dlp and FFmpeg are separate requirements. Compatible CodeShell
builds append their verified managed Node/bin to PATH; an existing PATH tool
keeps precedence. Other Hosts and standalone terminals need Node on PATH.
`--bin-dir /absolute/bin` explicitly appends a dependency directory. Never guess
Host private data directories. Node >=22 is offered to supported yt-dlp versions
as an explicit JavaScript runtime; website access still depends on current
yt-dlp/EJS support and the network.

**Install / Update** remains a deterministic, model-free workflow using official
GitHub releases, verified asset digests and the Host-managed executable directory.
Windows can fall back from curl to PowerShell; Windows/Linux use the official
FFmpeg build and macOS uses Homebrew. **AI Initialize / Repair** is optional and
uses a selected Host model in an isolated task. Neither setup path downloads a
video. Dependency changes are observed by the next cached environment check.

## Standalone CLI

Resolve `app/tools/video-download.mjs` from the project's selected installed
package, not a development checkout. `ops` describes current commands and schemas.
All commands except `ops`/`help` require an explicit absolute `--project`.

```sh
node "<package>/app/tools/video-download.mjs" ops
node "<package>/app/tools/video-download.mjs" doctor --project "/path/to/project"
node "<package>/app/tools/video-download.mjs" inspect --project "/path/to/project" --input-file inspect.json
node "<package>/app/tools/video-download.mjs" search --project "/path/to/project" --input-file search.json
node "<package>/app/tools/video-download.mjs" download --project "/path/to/project" --input-file download.json --background --request-key "stable-operation-id" --source chat
node "<package>/app/tools/video-download.mjs" jobs --project "/path/to/project"
node "<package>/app/tools/video-download.mjs" status --project "/path/to/project" --job "<task-id>"
node "<package>/app/tools/video-download.mjs" cancel --project "/path/to/project" --job "<task-id>"
node "<package>/app/tools/video-download.mjs" retry --project "/path/to/project" --job "<task-id>" --expected-attempt 1 --background
node "<package>/app/tools/video-download.mjs" check --project "/path/to/project" --job "<task-id>"
node "<package>/app/tools/video-download.mjs" archive --project "/path/to/project" --job "<task-id>"
node "<package>/app/tools/video-download.mjs" queue --project "/path/to/project"
```

Input examples:

```json
{
  "url": "https://example.com/video",
  "configuration": {
    "format": "1080",
    "subtitles": true,
    "subtitleMode": "both",
    "subtitleLanguages": "zh.*,en.*"
  }
}
```

`inspect` takes `{url, playlist?}`; `search` takes
`{query, platform:"both"|"youtube"|"bilibili", limit?}`. Downloads default to the
project's `downloads/`. A terminal's explicit `outputDirectory` may select another
absolute directory; the panel service only admits outputs within its authorized
project. Optional `title` is display text; `copySuffix` retains a distinct output
name for an explicitly requested copy.

`queue --input-file queue.json` applies
`{"expectedRevision":0,"paused":false,"maxConcurrent":2}`. Read the current revision
first. `start --job <id> --expected-attempt <n> --background` starts a pending task.
A retry retains its task ID and original request and increments its attempt.
Provide the observed attempt when automating retries so a lost reply cannot
restart a later completed attempt.

The same request key atomically returns the original submission. Reusing a key
with different content is rejected. Keep the frozen request and key while its
receipt is uncertain; query before creating a different operation. A start
receipt is not completion. Cancellation is a request until the worker confirms
termination. JSON is written to stdout; foreground progress is separate on stderr.

## Records, ownership and compatibility

`.mimi-download-cli/` stores private, bounded task records, stable work files,
project queue settings and environment snapshots. Existing 0.23 records and their
partial files remain readable. Writes are atomic and coordinated across processes.
Malformed sibling records are reported without deleting them. Archive markers
are shared with the panel, so hidden records do not reappear on reload.

A dead or uncertain worker does not prove its downloader children stopped.
Unconfirmed worker locks and queue slots are retained; recovery requires checking
both before an explicit retry. Never kill a process solely from a stored PID or
blindly remove locks. A download attempt is bounded to six hours. Actual byte or
fragment continuation depends on the media source.

Saved-account downloads, external directories chosen through the panel, and
previous Host queue/history retain their Host adapter. The unified UI presents
them alongside shared public tasks without moving Cookie material or editing
private Host storage. Their original pause/concurrency controls are labeled
**Account downloads and legacy queue**. Existing resource IDs and immutable Host
resources remain intact; ordinary CLI outputs do not fabricate resource IDs.
Legacy drafts and interrupted Host tasks require an explicit start/retry.

Saved Cookie downloads require advertised `tasks.*`, directory bookmarks and
Cookie-task capabilities. Account identity/site/revision are retained by the Host;
changed or denied grants never fall back to anonymous downloads. The standalone
CLI has no authenticated Host-account transport; use the authorized panel flow.
Older Hosts lacking reviewed native entry support retain their explicit legacy
mode. A failed shared-service request on a capable Host never silently switches
that public download to another backend.

Changing the project's execution binding invalidates the current page, preserving
unsaved links for copying and discarding late results. Reopen to load the current
project. Accepted workers keep their original project. No background operation
is restarted by opening, closing or migrating a panel.

## Package architecture and validation

- `app/tools/download-runtime.mjs`: shared media operations, worker lifecycle and service dispatch.
- `app/tools/video-download.mjs`: thin CLI adapter with stable import compatibility.
- `app/tools/service.mjs`: reviewed, bounded stdin entry; project authority comes from its actual cwd.
- `app/tools/cli-store.mjs`: persistent records, idempotent admission, queue slots and atomic locks.
- `app/tools/environment.mjs`: reviewed environment snapshots and version caches.
- `app/download-service.js`, `download-records.js`: browser service client and display model.
- `app/durable-downloads.js`: existing Host/account task adapter.

Run `npm test -- --suite video-download`, `node scripts/validate.mjs`, and
`npm run check`. Tests use private temporary projects, fake tools and explicit
network fixtures. Browser tests load the actual installed app assets through an
authorized Host fixture. These tests do not establish every external website,
real account, deployed Cloud or physical device combination.
