---
name: video-download-cli
description: Search, inspect and download public videos from Chat or a terminal, and manage the project's shared download tasks without keeping the Mimi Download panel open.
---

# Mimi Download from Chat

Use the selected package's CLI for public-video requests. The panel and CLI share
project download records and queue settings; opening the panel is optional.
Honor an explicit request to operate in the panel. Saved Host-account downloads
use the authorized panel workflow instead.

Resolve `../../..` from `${CODESHELL_SKILL_DIR}`. Confirm that package's
`.codeshell-panel/panel.json` has id `video-download` and use its
`app/tools/video-download.mjs`. Do not choose another installed version or a
repository checkout. Report `bundled-video-download-cli-not-found` if unavailable.

Use Node >=20.10 from the actual command environment. Compatible CodeShell builds
provide managed Node/bin on PATH; verify availability instead of inferring it
from the app version. yt-dlp and FFmpeg are separate dependencies. `--bin-dir`
may append an explicitly supplied absolute dependency directory; never guess
Host private directories.

Read `ops` for current commands and schemas. Use the current trusted project as
an explicit absolute `--project`, and pass structured media JSON through a quoted
`--input-file`. `doctor` uses the shared local-version cache; use `--refresh` after
repair and `--latest` only when a remote version query is useful. It also reports
optional yt-dlp JavaScript-runtime support. Do not require a diagnostic or install
operation before every otherwise valid download.

```sh
node "<package>/app/tools/video-download.mjs" ops
node "<package>/app/tools/video-download.mjs" search --project "<project>" --input-file "<search.json>"
node "<package>/app/tools/video-download.mjs" inspect --project "<project>" --input-file "<inspect.json>"
node "<package>/app/tools/video-download.mjs" download --project "<project>" --input-file "<download.json>" --background --request-key "<stable-operation-key>" --source chat
node "<package>/app/tools/video-download.mjs" status --project "<project>" --job "<task-id>"
node "<package>/app/tools/video-download.mjs" jobs --project "<project>"
```

Use the conversation to interpret search intent and rank retrieved candidates;
the CLI has no separate model credentials. Index evidence does not prove a video
is currently accessible. Inspect the selected URL when metadata is needed, and
do not claim to have watched its content.

Download when requested. Generate one operation key and freeze its JSON request;
retain both until submission is resolved. Use `--source chat` so its origin is
visible in the panel. A background receipt provides a task ID, not completion.
Retain a task ID for each requested URL and query `status`/`jobs` until each has
completed, explicitly failed or stopped, or reached a specific obstacle needing
user action. Parsing, running, queued and temporary busy states require continued
tracking; they are not final outcomes. Report completion from the task's final
state and output files, not its launch receipt or progress percentage. If the
user asks only to submit or queue tasks, stop after verifying each submission
and respect any request to leave them pending.

A missing or uncertain reply is a reason to inspect or reuse the same frozen
operation and key, never to create a new key and repeat the download. Reusing a
key with changed content is rejected. An incomplete original record is retained
for investigation. Read a failure before considering the retry workflow below;
do not automatically resubmit failed work.

When using Panel tools, metadata inspection is optional unless the request needs
it. `inspect_video` can return `status: "running"` after its short wait while the
inspection continues. Poll `get_video_download_context` at `activity.pollAfterMs`
while pending; do not repeat inspection, change the URL or call
`start_video_download` during that inspection. Check `activity.canSubmit` and
`activity.blockingReasons` before submitting. A temporary busy response means
wait and query again, not repeatedly attempt submission or stop the whole task.
After submission, retain `queueId` and pass it to `get_video_download_context`
to follow that item to its final state. Use its `files` and `filesComplete` to
assess outputs; `filesTruncated` means the response is only a file summary. On an
inspection failure, read the returned error and decide whether metadata is still
needed before retrying; a download failure must not trigger a blind resubmission.
Panel context contains the latest observed shared tasks, not a forced worker
query. Check `sharedObservation` for freshness, read errors, truncation and
warnings, and `queueTruncated` for response limits. If a tracked ID disappears or
observation fails, read the matching CLI task with `status --job <cliJobId>`
where available; never pass the panel's `cli:` prefix as a CLI UUID. Otherwise
report that its outcome cannot be confirmed. Missing or stale records prove
neither failure nor completion and never justify resubmission.

The queue defaults to two concurrent tasks. `queue` reads its revision; applying
`queue --input-file` requires that `expectedRevision`, `paused` and `maxConcurrent`
(1–4). Pausing stops admission while active downloads continue. Never change
project-wide queue policy solely to speed up a single request unless asked.

`cancel --job` requests cancellation. Report it as pending until the worker
confirms its process tree ended. Retry only after inspecting a failed, cancelled
or interrupted task, using `retry --job ... --expected-attempt <observed-attempt>
--background`. Retries preserve the ID, original request and partial files.
`start` explicitly starts a pending panel-created task. Opening a panel, process
restart or lost receipt is not permission to replay network work.

`check --job` verifies output files and persists their inventory state.
`archive --job` hides a terminal/pending record from normal listings and the panel;
it never deletes media. Do not archive records unless the user asks to remove
or clear them.

Records, environment snapshots and queue state live under the project's
`.mimi-download-cli/`. The panel automatically displays active downloads and
finished history. Existing Host/account tasks remain a distinct execution
backend within that interface: do not edit private Host storage, fabricate
resource IDs, or treat CLI IDs as Host task IDs. CLI external output directories
are supported when explicitly requested; the panel requires directory authority
before reading or opening those files. Never put Cookie contents, browser
profiles, model keys or opaque Host grants into a request or task record.

If the worker crashes or a process tree cannot be confirmed stopped, retained
worker locks and queue slots prevent overlapping downloads. Do not clear them or
signal a stored PID blindly. Explain the interruption and preserve partial files
for confirmed recovery and an explicit retry. Workers need a live machine and
execution environment; there is no persistent login daemon or automatic restart.

Queue continuation is explicit: `pump --project ...` (or the panel's **继续队列**)
reserves free FIFO slots; it does not create a worker for every waiting item.
`resume --project ...` also unpauses the queue. Ordinary reads never pump.
When a queue reports `stalled`, run read-only `doctor --slots --project ...`.
It prints exact slot IDs, attempts and tokens, plus PID/group observations.
A missing leader cannot establish that escaped descendants ended. Do not use
`recover-slot --job ... --attempt ... --token ... --confirm` until the user has
confirmed the original full process tree ended. Recovery changes only the exact
matching slot, never kills an unknown process, and leaves the task interrupted
for explicit retry. Automatic running-slot recovery requires a verified OS boot
identity change; unknown identities and Windows are manual only.

For queued CLI work saving outside the project, ordinary project-only continuation
shows `OUTPUT_AUTHORIZATION_REQUIRED`. After the user confirms those output paths,
run `pump --project ... --allow-outside-project` (or `resume` with that flag). Never
add this flag merely to hide an authorization warning. `doctor --slots` also lists
legacy worker locks without a slot; their exact id/attempt/token can be passed to
`recover-slot` only after confirming the old process tree ended. Live or unknown
PIDs are never reclaimed, including after a boot identity change.
